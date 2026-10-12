import type { Doc, El } from "./types";

/**
 * Components. Anything marked as a component is the main one: a frame, a group, or a single thing
 * such as a picture or a logo. Anything made from it is an instance: a live copy that follows the
 * main, apart from the things you changed on that copy.
 *
 * The copy's inside is not saved in the file. It is rebuilt from the main every time, so changing
 * the main changes every copy, and only the main and your changes are stored.
 */

const SEP = "::";

/** Things inside an instance are made from the component. Their ids start with the instance's id. */
export const isDerived = (id: string) => id.includes(SEP);

/** Can this be made into a component? Anything that is not already a copy of one. */
export const canBeComponent = (el: El | undefined): boolean => !!el && el.type !== "instance" && !el.component && !isDerived(el.id);

/** Does a component hold other things (a frame or a group), or is it one thing by itself (a picture, a shape, some text)? */
const holdsThings = (el: El) => el.type === "frame" || el.type === "group";

/**
 * A copy of a single thing, or of a group, has no box of its own to draw: only what is inside it shows.
 * A copy of a frame is drawn as a frame.
 */
export const isLooseCopy = (doc: Doc, el: El): boolean => el.type === "instance" && doc.elements[el.componentId]?.type !== "frame";

/** The instance that owns something inside it, and which part of the component it came from. */
export function ownerOf(id: string): { owner: string; key: string } | null {
  const i = id.indexOf(SEP);
  return i < 0 ? null : { owner: id.slice(0, i), key: id.slice(i + SEP.length) };
}

/** What an instance takes from its main, unless you changed it on the copy. */
const MIRRORED = ["fill", "stroke", "strokeWidth", "radius", "shadow", "gradient", "layout", "mask", "width", "height"] as const;
/** What can be changed on a thing inside an instance. */
const INSIDE = ["x", "y", "width", "height", "fill", "stroke", "strokeWidth", "radius", "opacity", "rotation", "text", "fontSize", "shadow", "gradient", "src", "nodes", "closed"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copy = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

let n = 0;
const fresh = (type: string) => `${type}-${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function descendantsOf(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (i: string) => {
    for (const c of doc.elements[i]?.childIds ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Turn an instance into an ordinary frame. Its insides become real, separate things. */
export function detachInstance(doc: Doc, id: string): Doc {
  const inst = doc.elements[id];
  if (!inst || inst.type !== "instance") return doc;
  const next = structuredClone(doc);
  const root = next.elements[id];
  // A copy of a single thing becomes that thing again, not a frame around it.
  const only = next.elements[`${id}${SEP}${inst.componentId}`];
  if (only && root.childIds.length === 1 && root.childIds[0] === only.id) {
    delete next.elements[only.id];
    next.elements[id] = { ...only, id, parentId: root.parentId, x: root.x, y: root.y, name: root.name, locked: root.locked, grow: root.grow, link: root.link, linkKind: root.linkKind, transition: root.transition, transitionMs: root.transitionMs, component: false, childIds: [] };
    return next;
  }
  const map: Record<string, string> = {};
  for (const d of descendantsOf(next, id)) map[d] = fresh(next.elements[d].type);
  for (const [oldId, newId] of Object.entries(map)) {
    const el = next.elements[oldId];
    delete next.elements[oldId];
    el.id = newId;
    next.elements[newId] = el;
  }
  for (const el of Object.values(next.elements)) {
    if (map[el.parentId ?? ""]) el.parentId = map[el.parentId as string];
    el.childIds = el.childIds.map((c) => map[c] ?? c);
  }
  root.type = "frame";
  root.componentId = "";
  root.overrides = {};
  root.childIds = root.childIds.map((c) => map[c] ?? c);
  return next;
}

/**
 * After a change, notice what was changed on a thing inside an instance, and keep it as that
 * instance's own change. Without this, the next rebuild from the main would undo it.
 */
export function captureOverrides(before: Doc, after: Doc): Doc {
  let next: Doc | null = null;
  for (const [id, el] of Object.entries(after.elements)) {
    const prev = before.elements[id];
    if (!prev) continue;
    let owner: string;
    let key: string;
    let props: readonly (keyof El)[];
    const o = ownerOf(id);
    if (o) {
      owner = o.owner;
      key = o.key;
      props = INSIDE;
    } else if (el.type === "instance") {
      owner = id;
      key = "$root";
      props = MIRRORED;
    } else continue;
    for (const k of props) {
      if (same(prev[k], el[k])) continue;
      next ??= structuredClone(after);
      const inst = next.elements[owner];
      if (!inst || inst.type !== "instance") continue;
      inst.overrides[key] = { ...(inst.overrides[key] ?? {}), [k]: copy(el[k]) };
    }
  }
  return next ?? after;
}

/** Rebuild the inside of every instance from its main, with that instance's own changes on top. */
export function syncInstances(doc: Doc): Doc {
  const roots = () => Object.values(doc.elements).filter((e) => e.type === "instance" && !isDerived(e.id));
  if (roots().length === 0) return doc;
  let next = structuredClone(doc);
  // An instance can sit inside a component that is itself used somewhere, so go round a few times.
  for (let pass = 0; pass < 3; pass++) {
    for (const inst of Object.values(next.elements).filter((e) => e.type === "instance" && !isDerived(e.id))) {
      const main = next.elements[inst.componentId];
      const inside = descendantsOf(next, inst.componentId).includes(inst.id);
      if (!main || !main.component || main.id === inst.id || inside) {
        next = detachInstance(next, inst.id); // the main is gone: keep what was there, as a plain frame
        continue;
      }
      for (const d of descendantsOf(next, inst.id)) delete next.elements[d];
      inst.childIds = [];
      const ro = inst.overrides["$root"] ?? {};
      for (const k of MIRRORED) (inst as unknown as Record<string, unknown>)[k] = k in ro ? copy(ro[k]) : copy(main[k]);
      if (!holdsThings(main)) {
        // A copy of a single thing, such as a picture: the copy is a clear box holding that one thing,
        // which fills it. So the look belongs to the thing inside, and sizing the copy sizes the thing.
        Object.assign(inst, { fill: "#00000000", stroke: null, shadow: null, gradient: null, radius: 0, layout: null, mask: false });
        const e: El = copy(main);
        e.id = `${inst.id}${SEP}${main.id}`;
        e.parentId = inst.id;
        e.component = false;
        e.childIds = [];
        e.x = 0;
        e.y = 0;
        e.width = inst.width;
        e.height = inst.height;
        e.link = null;
        e.locked = false;
        e.grow = 0;
        Object.assign(e, copy(inst.overrides[main.id] ?? {}), { x: 0, y: 0 });
        next.elements[e.id] = e;
        inst.childIds.push(e.id);
        continue;
      }
      const build = (srcId: string, parentId: string) => {
        const s = next.elements[srcId];
        if (!s) return;
        const e: El = copy(s);
        e.id = `${inst.id}${SEP}${srcId}`;
        e.parentId = parentId;
        e.component = false;
        e.childIds = [];
        Object.assign(e, copy(inst.overrides[srcId] ?? {}));
        next.elements[e.id] = e;
        next.elements[parentId].childIds.push(e.id);
        for (const c of s.childIds) build(c, e.id);
      };
      for (const c of main.childIds) build(c, inst.id);
    }
  }
  return next;
}

/** The components in a design. */
export const componentsIn = (doc: Doc): El[] => Object.values(doc.elements).filter((e) => e.component && !isDerived(e.id));
