import type { Doc, El } from "./types";

/** Property order inside each element, so Git diffs stay small and stable. */
const EL_KEYS: (keyof El)[] = [
  "id",
  "type",
  "name",
  "parentId",
  "x",
  "y",
  "width",
  "height",
  "fill",
  "stroke",
  "strokeWidth",
  "radius",
  "opacity",
  "text",
  "fontSize",
  "shadow",
  "gradient",
  "link",
  "src",
  "locked",
  "layout",
  "grow",
  "nodes",
  "closed",
  "childIds",
];

const FALLBACK: Omit<El, "id" | "type"> = {
  name: "Untitled",
  parentId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fill: "#d9d9de",
  stroke: null,
  strokeWidth: 1,
  radius: 0,
  opacity: 1,
  text: "",
  fontSize: 16,
  shadow: null,
  gradient: null,
  link: null,
  src: "",
  locked: false,
  layout: null,
  grow: 0,
  nodes: [],
  closed: false,
  childIds: [],
};

/** Stable, human-readable JSON: elements sorted by id, properties in a fixed order. */
export function serializeDoc(doc: Doc): string {
  const elements: Record<string, unknown> = {};
  for (const id of Object.keys(doc.elements).sort()) {
    const el = doc.elements[id];
    const ordered: Record<string, unknown> = {};
    for (const k of EL_KEYS) if ((k !== "locked" || el.locked) && (k !== "layout" || el.layout) && (k !== "grow" || el.grow) && (k !== "src" || el.type === "image") && ((k !== "nodes" && k !== "closed") || el.type === "path")) ordered[k] = el[k];
    elements[id] = ordered;
  }
  return JSON.stringify({ version: doc.version, rootIds: doc.rootIds, elements }, null, 2) + "\n";
}

export class DesignFileError extends Error {}

const TYPES = new Set(["frame", "rect", "ellipse", "text", "image", "path", "group"]);

/** Parse and check a design file. Fills in missing properties so older files still open. */
export function parseDoc(text: string): Doc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DesignFileError("This file is not valid JSON.");
  }
  const r = raw as Partial<Doc> | null;
  if (!r || typeof r !== "object" || r.version !== 1) throw new DesignFileError("This is not a Duet design file (version 1).");
  if (!Array.isArray(r.rootIds) || !r.elements || typeof r.elements !== "object") {
    throw new DesignFileError("The design file is missing its elements.");
  }
  const elements: Record<string, El> = {};
  for (const [id, value] of Object.entries(r.elements)) {
    const v = value as Partial<El>;
    if (!v || !TYPES.has(v.type as string)) throw new DesignFileError(`Element ${id} has an unknown type.`);
    elements[id] = { ...FALLBACK, ...v, id, type: v.type as El["type"] };
  }
  for (const id of r.rootIds) if (!elements[id]) throw new DesignFileError(`Page lists ${id}, but it does not exist.`);
  for (const el of Object.values(elements)) {
    for (const c of el.childIds) if (!elements[c]) throw new DesignFileError(`${el.name} lists a missing child ${c}.`);
  }
  return { version: 1, rootIds: r.rootIds as string[], elements };
}
