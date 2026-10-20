import type { Rect } from "../document/types";

/** Rulers, ruler guides and the hints shown while moving. The logic only: drawing is in render.ts. */

/** The width of the ruler along the top, and of the one down the left, in screen pixels. */
export const RULER = 18;

/** How far apart the marks are, in page pixels, at a zoom: small marks never closer than 8 screen pixels, numbers never closer than 56. */
export function rulerSteps(zoom: number): { minor: number; major: number } {
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const first = (screen: number) => nice.find((n) => n * zoom >= screen) ?? nice[nice.length - 1];
  const minor = first(8);
  const major = Math.max(first(56), minor);
  return { minor, major };
}

export interface Tick {
  /** Where, in page pixels. */
  at: number;
  /** Long, with a number beside it. */
  major: boolean;
}

/** The marks along a ruler that shows page pixels from `from` to `to`. */
export function rulerTicks(from: number, to: number, zoom: number): Tick[] {
  const { minor, major } = rulerSteps(zoom);
  const out: Tick[] = [];
  const start = Math.floor(from / minor) * minor;
  for (let at = start; at <= to; at += minor) {
    const r = Math.round(at * 1000) / 1000;
    out.push({ at: r, major: Math.abs(r % major) < 1e-6 });
  }
  return out;
}

export interface Guides {
  x: number[];
  y: number[];
}

export interface GuideSnap {
  dx: number;
  dy: number;
  x: number | null;
  y: number | null;
}

/** Snap the edges and centre of a moving box to ruler guides. */
export function snapToGuides(box: Rect, guides: Guides | undefined, threshold: number): GuideSnap {
  const out: GuideSnap = { dx: 0, dy: 0, x: null, y: null };
  if (!guides) return out;
  const best = (edges: number[], lines: number[]) => {
    let at: number | null = null;
    let delta = 0;
    let dist = threshold + 1;
    for (const e of edges)
      for (const g of lines) {
        const d = g - e;
        if (Math.abs(d) < dist) {
          dist = Math.abs(d);
          delta = d;
          at = g;
        }
      }
    return dist <= threshold ? { at, delta } : { at: null, delta: 0 };
  };
  const bx = best([box.x, box.x + box.width / 2, box.x + box.width], guides.x);
  const by = best([box.y, box.y + box.height / 2, box.y + box.height], guides.y);
  return { dx: bx.delta, dy: by.delta, x: bx.at, y: by.at };
}

/** The space between the moving box and the nearest neighbour on one side, shown as a measured line with a number. */
export interface Gap {
  axis: "x" | "y";
  /** Along the axis: where the gap starts and ends. */
  from: number;
  to: number;
  /** Across the axis: where the line is drawn. */
  at: number;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * The nearest neighbour to the left, right, above and below that shares some height or width with the box,
 * within `reach` page pixels. Each is a gap to draw with its size.
 */
export function gapsAround(box: Rect, others: Rect[], reach: number): Gap[] {
  const out: Gap[] = [];
  const pick = (axis: "x" | "y", side: "before" | "after") => {
    let best: { gap: number; o: Rect } | null = null;
    for (const o of others) {
      const across = axis === "x" ? overlap(box.y, box.y + box.height, o.y, o.y + o.height) : overlap(box.x, box.x + box.width, o.x, o.x + o.width);
      if (across <= 0) continue;
      const gap = axis === "x" ? (side === "before" ? box.x - (o.x + o.width) : o.x - (box.x + box.width)) : side === "before" ? box.y - (o.y + o.height) : o.y - (box.y + box.height);
      if (gap < 0 || gap > reach) continue;
      if (!best || gap < best.gap) best = { gap, o };
    }
    if (!best) return;
    const o = best.o;
    if (axis === "x") {
      const lo = Math.max(box.y, o.y);
      const hi = Math.min(box.y + box.height, o.y + o.height);
      const from = side === "before" ? o.x + o.width : box.x + box.width;
      out.push({ axis, from, to: from + best.gap, at: (lo + hi) / 2 });
    } else {
      const lo = Math.max(box.x, o.x);
      const hi = Math.min(box.x + box.width, o.x + o.width);
      const from = side === "before" ? o.y + o.height : box.y + box.height;
      out.push({ axis, from, to: from + best.gap, at: (lo + hi) / 2 });
    }
  };
  for (const axis of ["x", "y"] as const) for (const side of ["before", "after"] as const) pick(axis, side);
  return out;
}

/**
 * Snap so the box sits with the same space on both sides, between the nearest neighbour before and after it
 * (on one axis), or so the space to a neighbour matches a space that already exists between two others.
 */
export function snapEqualGaps(box: Rect, others: Rect[], threshold: number, reach: number): { dx: number; dy: number; gaps: Gap[] } {
  let dx = 0;
  let dy = 0;
  const gaps: Gap[] = [];
  for (const axis of ["x", "y"] as const) {
    const before = gapsAround(box, others, reach).find((g) => g.axis === axis && g.to <= (axis === "x" ? box.x : box.y) + 0.001);
    const after = gapsAround(box, others, reach).find((g) => g.axis === axis && g.from >= (axis === "x" ? box.x + box.width : box.y + box.height) - 0.001);
    if (before && after) {
      const a = before.to - before.from;
      const b = after.to - after.from;
      const shift = (b - a) / 2;
      if (Math.abs(shift) <= threshold) {
        if (axis === "x") dx = shift;
        else dy = shift;
      }
    }
  }
  if (dx || dy) {
    const moved = { ...box, x: box.x + dx, y: box.y + dy };
    for (const g of gapsAround(moved, others, reach)) gaps.push(g);
  }
  return { dx, dy, gaps };
}
