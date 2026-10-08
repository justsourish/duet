import { isDerived, syncInstances } from "./components";
import { relayout } from "./layout";
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
  "fontFamily",
  "fontWeight",
  "textAlign",
  "lineHeight",
  "letterSpacing",
  "textFixed",
  "textStyleId",
  "shadow",
  "gradient",
  "link",
  "src",
  "component",
  "componentId",
  "overrides",
  "locked",
  "layout",
  "grow",
  "nodes",
  "closed",
  "childIds",
];

const TEXT_ONLY = new Set<keyof El>(["fontFamily", "fontWeight", "textAlign", "lineHeight", "letterSpacing", "textFixed", "textStyleId"]);

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
  fontFamily: "",
  fontWeight: 400,
  textAlign: "left",
  lineHeight: 0,
  letterSpacing: 0,
  textFixed: false,
  textStyleId: "",
  shadow: null,
  gradient: null,
  link: null,
  src: "",
  component: false,
  componentId: "",
  overrides: {},
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
    if (isDerived(id)) continue; // the inside of a copy is rebuilt from its component
    const el = doc.elements[id];
    const ordered: Record<string, unknown> = {};
    for (const k of EL_KEYS) if (TEXT_ONLY.has(k) && (el.type !== "text" || el[k] === (FALLBACK as Record<string, unknown>)[k])) continue;
    else if (k === "childIds" && el.type === "instance") ordered[k] = [];
    else if ((k !== "component" || el.component) && ((k !== "componentId" && k !== "overrides") || el.type === "instance") && (k !== "locked" || el.locked) && (k !== "layout" || el.layout) && (k !== "grow" || el.grow) && (k !== "src" || el.type === "image") && ((k !== "nodes" && k !== "closed") || el.type === "path")) ordered[k] = el[k];
    elements[id] = ordered;
  }
  const out: Record<string, unknown> = { version: doc.version, rootIds: doc.rootIds, elements };
  if (doc.styles && Object.keys(doc.styles).length) out.styles = doc.styles;
  return JSON.stringify(out, null, 2) + "\n";
}

export class DesignFileError extends Error {}

const TYPES = new Set(["frame", "rect", "ellipse", "text", "image", "path", "group", "instance"]);

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
  const styles = r.styles && typeof r.styles === "object" ? (r.styles as Doc["styles"]) : undefined;
  return relayout(syncInstances({ version: 1, rootIds: r.rootIds as string[], elements, ...(styles ? { styles } : {}) }));
}
