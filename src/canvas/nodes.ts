import { worldPos } from "../document/geometry";
import { fromAbs, isSmooth, nearestOnLine, removeNode, splitSegment, toAbs, toggleSmooth } from "../document/path";
import type { AbsNode } from "../document/path";
import type { Doc } from "../document/types";
import { currentDoc, dispatch, dragBase, dragPreviewDoc, getState, select, setOverlay } from "../state/store";
import { runCommand } from "../commands";

/** Editing the points of a drawn line: move points, pull handles, add and remove points. */

export type Part = "anchor" | "in" | "out";
export interface NodeHit {
  part: Part;
  index: number;
}

const GRAB = 7;

export const editing = () => getState().overlay.nodeEdit;

export function enterNodeEdit(id: string) {
  select([id]);
  setOverlay({ nodeEdit: { id, selected: null } });
}

export function exitNodeEdit() {
  if (editing()) setOverlay({ nodeEdit: null });
}

export function selectNode(index: number | null) {
  const e = editing();
  if (e) setOverlay({ nodeEdit: { ...e, selected: index } });
}

/** The points of the line being edited, in page pixels. */
export function nodesOf(doc: Doc, id: string): AbsNode[] {
  const el = doc.elements[id];
  if (!el || el.type !== "path") return [];
  const at = worldPos(doc, id);
  return toAbs(el, at.x, at.y);
}

/** Write new points back into the element, refitting its box. Returns the document, not yet committed. */
export function withNodes(doc: Doc, id: string, nodes: AbsNode[]): Doc {
  const el = doc.elements[id];
  const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
  const shape = fromAbs(nodes);
  return runCommand(doc, "set_props", {
    ids: [id],
    props: { x: shape.x - parent.x, y: shape.y - parent.y, width: shape.width, height: shape.height, nodes: shape.nodes },
  });
}

/** Which point or handle is under the pointer. Handles only show for the chosen point. */
export function hitNode(sx: number, sy: number): NodeHit | null {
  const s = getState();
  const e = s.overlay.nodeEdit;
  if (!e) return null;
  const nodes = nodesOf(currentDoc(s), e.id);
  const z = s.viewport.zoom;
  const screen = (x: number, y: number) => ({ x: x * z + s.viewport.x, y: y * z + s.viewport.y });
  const near = (x: number, y: number) => {
    const p = screen(x, y);
    return Math.hypot(sx - p.x, sy - p.y) <= GRAB;
  };
  if (e.selected !== null && nodes[e.selected]) {
    const n = nodes[e.selected];
    if ((n.ox || n.oy) && near(n.x + n.ox, n.y + n.oy)) return { part: "out", index: e.selected };
    if ((n.ix || n.iy) && near(n.x + n.ix, n.y + n.iy)) return { part: "in", index: e.selected };
  }
  for (let i = nodes.length - 1; i >= 0; i--) if (near(nodes[i].x, nodes[i].y)) return { part: "anchor", index: i };
  return null;
}

/** Move a point or a handle. `start` is how the points were when the drag began. */
export function dragNode(hit: NodeHit, start: AbsNode[], dx: number, dy: number, alt: boolean) {
  const e = editing();
  if (!e) return;
  const nodes = start.map((n) => ({ ...n }));
  const n = nodes[hit.index];
  const was = start[hit.index];
  if (hit.part === "anchor") {
    n.x = was.x + dx;
    n.y = was.y + dy;
  } else if (hit.part === "out") {
    n.ox = was.ox + dx;
    n.oy = was.oy + dy;
    if (!alt && isSmooth(was)) {
      // keep the other handle opposite, with its own length
      const len = Math.hypot(was.ix, was.iy);
      const l = Math.hypot(n.ox, n.oy) || 1;
      n.ix = (-n.ox / l) * len;
      n.iy = (-n.oy / l) * len;
    }
  } else {
    n.ix = was.ix + dx;
    n.iy = was.iy + dy;
    if (!alt && isSmooth(was)) {
      const len = Math.hypot(was.ox, was.oy);
      const l = Math.hypot(n.ix, n.iy) || 1;
      n.ox = (-n.ix / l) * len;
      n.oy = (-n.iy / l) * len;
    }
  }
  dragPreviewDoc(withNodes(dragBase(), e.id, nodes));
}

function commitNodes(nodes: AbsNode[], label: string) {
  const e = editing();
  if (!e) return;
  const doc = currentDoc();
  const el = doc.elements[e.id];
  const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
  const shape = fromAbs(nodes);
  dispatch("set_props", {
    ids: [e.id],
    props: { x: shape.x - parent.x, y: shape.y - parent.y, width: shape.width, height: shape.height, nodes: shape.nodes },
    label,
  });
}

/** Double-click: on a point it turns it smooth or sharp, on the line it adds a point. */
export function doubleClickNode(wx: number, wy: number, hit: NodeHit | null): boolean {
  const e = editing();
  if (!e) return false;
  const doc = currentDoc();
  const el = doc.elements[e.id];
  if (!el) return false;
  const nodes = nodesOf(doc, e.id);
  if (hit && hit.part === "anchor") {
    commitNodes(toggleSmooth(nodes, el.closed, hit.index), "Smooth or sharpen a point");
    selectNode(hit.index);
    return true;
  }
  const near = nearestOnLine(nodes, el.closed, wx, wy);
  const reach = 8 / getState().viewport.zoom;
  if (near.segment >= 0 && near.distance <= reach) {
    const r = splitSegment(nodes, el.closed, near.segment, near.t);
    commitNodes(r.nodes, "Add a point");
    selectNode(r.index);
    return true;
  }
  return false;
}

/** Delete the chosen point. */
export function deleteSelectedNode(): boolean {
  const e = editing();
  if (!e || e.selected === null) return false;
  const doc = currentDoc();
  const el = doc.elements[e.id];
  const nodes = nodesOf(doc, e.id);
  const next = removeNode(nodes, el.closed, e.selected);
  if (next === nodes) return true;
  commitNodes(next, "Remove a point");
  selectNode(null);
  return true;
}
