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
  const visit = (ids: string[], ox: number, oy: number): string | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const el = doc.elements[ids[i]];
      if (!el || ignore.has(el.id)) continue;
      const r = { x: ox + el.x, y: oy + el.y, width: el.width, height: el.height };
      if (el.type === "path" && !el.closed) {
        // a thin line: hit it when the pointer is close to the line itself
        const reach = Math.max(6, el.strokeWidth / 2 + 4);
        if (distanceToLine(wx, wy, flatten(toAbs(el, r.x, r.y), false)) > reach || el.locked) continue;
        return el.id;
      }
      if (!pointInRect(wx, wy, r)) continue;
      if (el.type === "ellipse") {
        const rx = r.width / 2;
        const ry = r.height / 2;
        const dx = (wx - (r.x + rx)) / rx;
        const dy = (wy - (r.y + ry)) / ry;
        if (dx * dx + dy * dy > 1) continue;
      }
      if (el.childIds.length) {
        const child = visit(el.childIds, r.x, r.y);
        // a click anywhere inside a group picks the whole group, unless you dig in on purpose
        if (child) return el.type === "group" && !deep && !el.locked ? el.id : child;
      }
      // a group has no body of its own, and a locked thing cannot be picked: clicks go through
      if (el.type === "group" || el.locked) continue;
      return el.id;
    }
    return null;
  };
  return visit(doc.rootIds, 0, 0);
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
