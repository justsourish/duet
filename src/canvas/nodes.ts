import { keepInPlace, turnOf, turnPoint, turnVector, worldPos, worldRect } from "../document/geometry";
import { fromAbs, isSmooth, nearestOnLine, removeNodes, splitSegment, toAbs, toggleSmooth } from "../document/path";
import type { AbsNode } from "../document/path";
import type { Doc } from "../document/types";
import { workDoc, dispatch, dragBase, dragPreviewDoc, getState, select, setOverlay } from "../state/store";
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
  setOverlay({ nodeEdit: { id, selected: [] } });
}

export function exitNodeEdit() {
  if (editing()) setOverlay({ nodeEdit: null });
}

export function selectNode(index: number | null) {
  const e = editing();
  if (e) setOverlay({ nodeEdit: { ...e, selected: index === null ? [] : [index] } });
}

export function selectNodes(indices: number[]) {
  const e = editing();
  if (e) setOverlay({ nodeEdit: { ...e, selected: Array.from(new Set(indices)) } });
}

export function toggleNode(index: number) {
  const e = editing();
  if (!e) return;
  const has = e.selected.includes(index);
  const next = has ? e.selected.filter((i) => i !== index) : [...e.selected, index];
  setOverlay({ nodeEdit: { ...e, selected: next } });
}

/** The points of the line being edited, in page pixels, as they sit before the line is turned. */
export function nodesOf(doc: Doc, id: string): AbsNode[] {
  const el = doc.elements[id];
  if (!el || el.type !== "path") return [];
  const at = worldPos(doc, id);
  return toAbs(el, at.x, at.y);
}

/** The world positions of all anchor points of the path (following rotation if turned). */
export function worldNodesOf(doc: Doc, id: string): { x: number; y: number }[] {
  const el = doc.elements[id];
  if (!el || el.type !== "path") return [];
  const r = worldRect(doc, id);
  const turn = turnOf(el);
  const nodes = toAbs(el, r.x, r.y);
  return nodes.map((n) => (turn ? turnPoint(n.x, n.y, r.x + r.width / 2, r.y + r.height / 2, turn) : { x: n.x, y: n.y }));
}

/** A spot on the page, turned back so it lines up with the points of a turned line. */
function upright(doc: Doc, id: string, x: number, y: number): { x: number; y: number } {
  const r = worldRect(doc, id);
  return turnPoint(x, y, r.x + r.width / 2, r.y + r.height / 2, -turnOf(doc.elements[id]));
}

/** The new box and points for a line, placed so that a turned line does not jump when its box changes. */
function refit(doc: Doc, id: string, nodes: AbsNode[]) {
  const el = doc.elements[id];
  const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
  const shape = fromAbs(nodes);
  const box = keepInPlace(worldRect(doc, id), shape, turnOf(el));
  return { x: box.x - parent.x, y: box.y - parent.y, width: shape.width, height: shape.height, nodes: shape.nodes };
}

/** Write new points back into the element, refitting its box. Returns the document, not yet committed. */
export function withNodes(doc: Doc, id: string, nodes: AbsNode[]): Doc {
  return runCommand(doc, "set_props", { ids: [id], props: refit(doc, id, nodes) });
}

/** Which point or handle is under the pointer. Handles show for chosen points. */
export function hitNode(sx: number, sy: number): NodeHit | null {
  const s = getState();
  const e = s.overlay.nodeEdit;
  if (!e) return null;
  const nodes = nodesOf(workDoc(s), e.id);
  const z = s.viewport.zoom;
  // where the pointer is on the page, turned back to meet the points
  const at = upright(workDoc(s), e.id, (sx - s.viewport.x) / z, (sy - s.viewport.y) / z);
  const near = (x: number, y: number) => Math.hypot(at.x - x, at.y - y) * z <= GRAB;
  for (const idx of e.selected) {
    if (nodes[idx]) {
      const n = nodes[idx];
      if ((n.ox || n.oy) && near(n.x + n.ox, n.y + n.oy)) return { part: "out", index: idx };
      if ((n.ix || n.iy) && near(n.x + n.ix, n.y + n.iy)) return { part: "in", index: idx };
    }
  }
  for (let i = nodes.length - 1; i >= 0; i--) if (near(nodes[i].x, nodes[i].y)) return { part: "anchor", index: i };
  return null;
}

/** Move a point or a handle. `start` is how the points were when the drag began. */
export function dragNode(hit: NodeHit, start: AbsNode[], dx: number, dy: number, alt: boolean) {
  const e = editing();
  if (!e) return;
  // read the movement along the line's own sides when it is turned
  const along = turnVector(dx, dy, -turnOf(dragBase().elements[e.id]));
  dx = along.x;
  dy = along.y;
  const nodes = start.map((n) => ({ ...n }));
  const was = start[hit.index];
  if (hit.part === "anchor") {
    const indices = e.selected.includes(hit.index) ? e.selected : [hit.index];
    for (const idx of indices) {
      if (nodes[idx] && start[idx]) {
        nodes[idx].x = start[idx].x + dx;
        nodes[idx].y = start[idx].y + dy;
      }
    }
  } else if (hit.part === "out") {
    const n = nodes[hit.index];
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
    const n = nodes[hit.index];
    n.ix = was.ix + dx;
    n.iy = was.iy + dy;
    if (!alt && isSmooth(was)) {
      const len = Math.hypot(was.ox, was.oy);
      const l = Math.hypot(n.ix, n.iy) || 1;
      n.ox = (-n.ix / l) * len;
      n.oy = (-n.oy / l) * len;
    }
  }
  dragPreviewDoc(withNodes(dragBase(), e.id, nodes));
}

function commitNodes(nodes: AbsNode[], label: string) {
  const e = editing();
  if (!e) return;
  dispatch("set_props", { ids: [e.id], props: refit(workDoc(), e.id, nodes), label });
}

/** Double-click: on a point it turns it smooth or sharp, on the line it adds a point. */
export function doubleClickNode(wx: number, wy: number, hit: NodeHit | null): boolean {
  const e = editing();
  if (!e) return false;
  const doc = workDoc();
  const el = doc.elements[e.id];
  if (!el) return false;
  const nodes = nodesOf(doc, e.id);
  if (hit && hit.part === "anchor") {
    commitNodes(toggleSmooth(nodes, el.closed, hit.index), "Smooth or sharpen a point");
    selectNode(hit.index);
    return true;
  }
  const at = upright(doc, e.id, wx, wy);
  const near = nearestOnLine(nodes, el.closed, at.x, at.y);
  const reach = 8 / getState().viewport.zoom;
  if (near.segment >= 0 && near.distance <= reach) {
    const r = splitSegment(nodes, el.closed, near.segment, near.t);
    commitNodes(r.nodes, "Add a point");
    selectNode(r.index);
    return true;
  }
  return false;
}

/** Delete the chosen points. */
export function deleteSelectedNodes(): boolean {
  const e = editing();
  if (!e || e.selected.length === 0) return false;
  const doc = workDoc();
  const el = doc.elements[e.id];
  const nodes = nodesOf(doc, e.id);
  const next = removeNodes(nodes, el.closed, e.selected);
  if (next === nodes) return true;
  const label = e.selected.length > 1 ? `Remove ${e.selected.length} points` : "Remove a point";
  commitNodes(next, label);
  selectNodes([]);
  return true;
}

export const deleteSelectedNode = deleteSelectedNodes;

/** Nudge all selected points with arrow keys. */
export function nudgeSelectedNodes(dx: number, dy: number): boolean {
  const e = editing();
  if (!e || e.selected.length === 0) return false;
  const doc = workDoc();
  const el = doc.elements[e.id];
  if (!el) return false;
  const along = turnVector(dx, dy, -turnOf(el));
  const nodes = nodesOf(doc, e.id).map((n, i) => {
    if (e.selected.includes(i)) {
      return { ...n, x: n.x + along.x, y: n.y + along.y };
    }
    return { ...n };
  });
  const label = e.selected.length > 1 ? `Nudge ${e.selected.length} points` : "Nudge point";
  commitNodes(nodes, label);
  return true;
}
