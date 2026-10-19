import { distanceToLine, flatten, toAbs } from "./path";
import type { Doc, El, Rect } from "./types";

export function worldPos(doc: Doc, id: string): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: El | undefined = doc.elements[id];
  while (cur) {
    x += cur.x;
    y += cur.y;
    cur = cur.parentId ? doc.elements[cur.parentId] : undefined;
  }
  return { x, y };
}

export function worldRect(doc: Doc, id: string): Rect {
  const el = doc.elements[id];
  const p = worldPos(doc, id);
  return { x: p.x, y: p.y, width: el.width, height: el.height };
}

/** How far a thing is drawn turned, in degrees. Frames, groups and copies of components are never turned themselves. */
export const turnOf = (el: El): number => (el.type === "frame" || el.type === "group" || el.type === "instance" ? 0 : el.rotation || 0);

/** An angle kept between -180 and 180, the way a designer reads it. */
export function tidyAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  const r = Math.round(a * 100) / 100;
  return r === -180 ? 180 : r || 0;
}

/** Turn a direction clockwise by some degrees. */
export function turnVector(dx: number, dy: number, deg: number): { x: number; y: number } {
  if (!deg) return { x: dx, y: dy };
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Turn a point clockwise around a centre. */
export function turnPoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const v = turnVector(px - cx, py - cy, deg);
  return { x: cx + v.x, y: cy + v.y };
}

/** The upright box that holds a box once it is turned around its centre. */
export function turnedBox(r: Rect, deg: number): Rect {
  if (!deg) return r;
  const a = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const width = r.width * c + r.height * s;
  const height = r.width * s + r.height * c;
  return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height };
}

/** The upright box on the page that holds a thing as it is drawn, turned or not. */
export function worldBounds(doc: Doc, id: string): Rect {
  return turnedBox(worldRect(doc, id), turnOf(doc.elements[id]));
}

/**
 * A turned thing spins around the middle of its box. When its box changes, the middle moves, and the
 * thing would jump. Given the old box and the new one (both as they sit before turning), this is where
 * the new box must go so that what you see stays put.
 */
export function keepInPlace(before: Rect, after: Rect, deg: number): Rect {
  if (!deg) return after;
  const c = turnPoint(after.x + after.width / 2, after.y + after.height / 2, before.x + before.width / 2, before.y + before.height / 2, deg);
  return { x: c.x - after.width / 2, y: c.y - after.height / 2, width: after.width, height: after.height };
}

/** Can this be turned? Frames and copies of components cannot, and neither can a group that holds one. */
export function canTurn(doc: Doc, id: string): boolean {
  const el = doc.elements[id];
  if (!el || el.type === "frame" || el.type === "instance") return false;
  return el.type !== "group" || descendants(doc, id).every((d) => doc.elements[d].type !== "frame" && doc.elements[d].type !== "instance");
}

/** The point a thing spins around, on the page. For a group it is the middle of the things inside it. */
export function turnCentre(doc: Doc, id: string): { x: number; y: number } {
  const el = doc.elements[id];
  const parts = el.type === "group" ? descendants(doc, id).filter((d) => doc.elements[d].type !== "group") : [];
  const of = parts.length ? parts : [id];
  let x = 0;
  let y = 0;
  for (const p of of) {
    const r = worldRect(doc, p);
    x += r.x + r.width / 2;
    y += r.y + r.height / 2;
  }
  return { x: x / of.length, y: y / of.length };
}

/** Can this shape be used as a mask? A rectangle, an ellipse, or a closed drawn shape. */
export const canMask = (el: El | undefined): boolean => !!el && (el.type === "rect" || el.type === "ellipse" || (el.type === "path" && el.closed && el.nodes.length > 2));

/** The shape a mask group shows its contents through: the bottom thing inside it. Null when it is not a mask. */
export function maskOf(doc: Doc, el: El): El | null {
  if (!el.mask || (el.type !== "group" && el.type !== "instance")) return null;
  const first = doc.elements[el.childIds[0]];
  return canMask(first) && el.childIds.length > 1 ? first : null;
}

/** Is a point inside a many-cornered outline? */
function insideOutline(px: number, py: number, line: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = line.length - 1; i < line.length; j = i++) {
    const a = line[i];
    const b = line[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Is a point on the page inside a shape, as the shape is drawn? x0 and y0 are where its box sits. */
export function insideShape(el: El, x0: number, y0: number, px: number, py: number): boolean {
  const p = turnPoint(px, py, x0 + el.width / 2, y0 + el.height / 2, -turnOf(el));
  if (!pointInRect(p.x, p.y, { x: x0, y: y0, width: el.width, height: el.height })) return false;
  if (el.type === "ellipse") {
    const dx = (p.x - (x0 + el.width / 2)) / (el.width / 2);
    const dy = (p.y - (y0 + el.height / 2)) / (el.height / 2);
    return dx * dx + dy * dy <= 1;
  }
  if (el.type === "path") return insideOutline(p.x, p.y, flatten(toAbs(el, x0, y0), true));
  return true;
}

export function descendants(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (cur: string) => {
    for (const c of doc.elements[cur]?.childIds ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

export function ancestors(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let cur = doc.elements[id]?.parentId;
  while (cur) {
    out.push(cur);
    cur = doc.elements[cur]?.parentId ?? null;
  }
  return out;
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Deepest element under a world point. Children are clipped by their frame. */
export function hitTest(doc: Doc, wx: number, wy: number, ignore: Set<string> = new Set(), deep = false): string | null {
  const visit = (ids: string[], ox: number, oy: number, px: number, py: number): string | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const el = doc.elements[ids[i]];
      // a sound is only heard and a hidden thing is not there, so there is nothing to point at
      if (!el || ignore.has(el.id) || el.type === "sound" || el.hidden) continue;
      const r = { x: ox + el.x, y: oy + el.y, width: el.width, height: el.height };
      // for a turned thing, turn the pointer back the other way and test it as if it were upright
      const turn = turnOf(el);
      const at = turn ? turnPoint(px, py, r.x + r.width / 2, r.y + r.height / 2, -turn) : null;
      const wx = at ? at.x : px;
      const wy = at ? at.y : py;
      if (el.type === "path" && !el.closed) {
        // a thin line: hit it when the pointer is close to the line itself
        const reach = Math.max(6, el.strokeWidth / 2 + 4);
        if (distanceToLine(wx, wy, flatten(toAbs(el, r.x, r.y), false)) > reach || el.locked) continue;
        return el.id;
      }
      if (!pointInRect(wx, wy, r)) continue;
      // a mask group is only there where its shape is
      const mask = maskOf(doc, el);
      if (mask && !insideShape(mask, r.x + mask.x, r.y + mask.y, wx, wy)) continue;
      if (el.type === "ellipse") {
        const rx = r.width / 2;
        const ry = r.height / 2;
        const dx = (wx - (r.x + rx)) / rx;
        const dy = (wy - (r.y + ry)) / ry;
        if (dx * dx + dy * dy > 1) continue;
      }
      if (el.childIds.length) {
        const child = visit(el.childIds, r.x, r.y, wx, wy);
        // a click anywhere inside a group picks the whole group, unless you dig in on purpose
        if (child) return (el.type === "group" || el.type === "instance") && !deep && !el.locked ? el.id : child;
      }
      // a group has no body of its own, and a locked thing cannot be picked: clicks go through
      if (el.type === "group" || el.locked) continue;
      return el.id;
    }
    return null;
  };
  return visit(doc.rootIds, 0, 0, wx, wy);
}

/** Deepest frame under a world point, used as the parent of new shapes. */
export function frameAt(doc: Doc, wx: number, wy: number): string | null {
  let found: string | null = null;
  const visit = (ids: string[], ox: number, oy: number) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const el = doc.elements[ids[i]];
      if (!el || el.type !== "frame") continue;
      const r = { x: ox + el.x, y: oy + el.y, width: el.width, height: el.height };
      if (!pointInRect(wx, wy, r)) continue;
      found = el.id;
      visit(el.childIds, r.x, r.y);
      return;
    }
  };
  visit(doc.rootIds, 0, 0);
  return found;
}

/** Selected ids with any element removed whose ancestor is also selected. */
export function topLevelOnly(doc: Doc, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !ancestors(doc, id).some((a) => set.has(a)));
}

export interface SnapResult {
  dx: number;
  dy: number;
  guidesX: number[];
  guidesY: number[];
}

/**
 * Snap a moving rectangle to the edges and centres of other rectangles.
 * Returns the correction to add to the movement, plus guide positions to draw.
 */
export function snapRect(moving: Rect, others: Rect[], threshold: number): SnapResult {
  const mx = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const my = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  let bestX = threshold + 1;
  let bestY = threshold + 1;
  let dx = 0;
  let dy = 0;
  let gx = 0;
  let gy = 0;
  for (const o of others) {
    const ox = [o.x, o.x + o.width / 2, o.x + o.width];
    const oy = [o.y, o.y + o.height / 2, o.y + o.height];
    for (const a of mx)
      for (const b of ox) {
        const d = b - a;
        if (Math.abs(d) < Math.abs(bestX)) {
          bestX = d;
          dx = d;
          gx = b;
        }
      }
    for (const a of my)
      for (const b of oy) {
        const d = b - a;
        if (Math.abs(d) < Math.abs(bestY)) {
          bestY = d;
          dy = d;
          gy = b;
        }
      }
  }
  const hitX = Math.abs(bestX) <= threshold;
  const hitY = Math.abs(bestY) <= threshold;
  return {
    dx: hitX ? dx : 0,
    dy: hitY ? dy : 0,
    guidesX: hitX ? [gx] : [],
    guidesY: hitY ? [gy] : [],
  };
}
