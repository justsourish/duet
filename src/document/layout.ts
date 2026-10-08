import type { Doc, El, Layout } from "./types";

/**
 * Auto layout. A frame can line its children up in a row or a column, with a gap, padding,
 * alignment, and an option to shrink around its content ("hug"). Positions are worked out here,
 * after every change, so the saved file always holds the final numbers.
 */

export const defaultLayout = (): Layout => ({
  dir: "column",
  gap: 12,
  padX: 16,
  padY: 16,
  align: "start",
  justify: "start",
  hug: false,
});

const round = (n: number) => Math.round(n * 100) / 100;

function depthOf(doc: Doc, el: El): number {
  let d = 0;
  let cur: El | undefined = el;
  while (cur?.parentId) {
    d++;
    cur = doc.elements[cur.parentId];
  }
  return d;
}

/**
 * Put a frame's children in the order they sit, along its direction. Used when a child is dragged,
 * dropped in, or when auto layout is first switched on. Only frames with auto layout are touched.
 */
export function orderByPosition(doc: Doc, frameId: string | null) {
  const frame = frameId ? doc.elements[frameId] : null;
  if (!frame?.layout) return;
  const row = frame.layout.dir === "row";
  const key = (c: El) => (row ? c.x + c.width / 2 : c.y + c.height / 2);
  const kids = frame.childIds.map((id, i) => ({ c: doc.elements[id], i })).filter((o) => o.c);
  kids.sort((a, b) => key(a.c) - key(b.c) || a.i - b.i);
  frame.childIds = kids.map((o) => o.c.id);
}

function layoutFrame(doc: Doc, frame: El, sizeChildren: boolean) {
  const layout = frame.layout;
  if (!layout) return;
  const row = layout.dir === "row";
  const kids = frame.childIds.map((id) => doc.elements[id]).filter(Boolean);
  if (kids.length === 0) return;

  const padMain = row ? layout.padX : layout.padY;
  const padCross = row ? layout.padY : layout.padX;
  const mainOf = (c: El) => (row ? c.width : c.height);
  const crossOf = (c: El) => (row ? c.height : c.width);
  const setMain = (c: El, v: number) => (row ? (c.width = Math.max(1, v)) : (c.height = Math.max(1, v)));
  const setCross = (c: El, v: number) => (row ? (c.height = Math.max(1, v)) : (c.width = Math.max(1, v)));

  let innerMain = (row ? frame.width : frame.height) - padMain * 2;
  let innerCross = (row ? frame.height : frame.width) - padCross * 2;

  if (sizeChildren) {
    if (layout.align === "stretch" && !layout.hug) for (const c of kids) if (c.type !== "text") setCross(c, innerCross);
    if (!layout.hug) {
      const growers = kids.filter((c) => c.grow > 0);
      if (growers.length) {
        const used = kids.reduce((s, c) => s + mainOf(c), 0) + layout.gap * (kids.length - 1);
        const free = innerMain - used;
        if (free > 0) for (const c of growers) setMain(c, mainOf(c) + (free * c.grow) / growers.reduce((s, g) => s + g.grow, 0));
      }
    }
  }

  const total = kids.reduce((s, c) => s + mainOf(c), 0);
  const gaps = layout.gap * (kids.length - 1);
  if (layout.hug) {
    const main = total + gaps + padMain * 2;
    const cross = Math.max(...kids.map(crossOf)) + padCross * 2;
    if (row) {
      frame.width = Math.max(1, round(main));
      frame.height = Math.max(1, round(cross));
    } else {
      frame.height = Math.max(1, round(main));
      frame.width = Math.max(1, round(cross));
    }
    innerMain = main - padMain * 2;
    innerCross = cross - padCross * 2;
    if (layout.align === "stretch") for (const c of kids) if (c.type !== "text") setCross(c, innerCross);
  }

  let gap = layout.gap;
  let start = padMain;
  const free = innerMain - total - gaps;
  if (layout.justify === "center") start += free / 2;
  else if (layout.justify === "end") start += free;
  else if (layout.justify === "between" && kids.length > 1) gap = (innerMain - total) / (kids.length - 1);

  let at = start;
  for (const c of kids) {
    const cross = crossOf(c);
    let off = padCross;
    if (layout.align === "center") off += (innerCross - cross) / 2;
    else if (layout.align === "end") off += innerCross - cross;
    if (row) {
      c.x = round(at);
      c.y = round(off);
    } else {
      c.y = round(at);
      c.x = round(off);
    }
    at += mainOf(c) + gap;
  }
}

/** A group is exactly as big as what is inside it. Inner groups first. */
function fitGroups(doc: Doc) {
  const groups = Object.values(doc.elements).filter((e) => e.type === "group");
  groups.sort((a, b) => depthOf(doc, b) - depthOf(doc, a));
  for (const g of groups) {
    const kids = g.childIds.map((id) => doc.elements[id]).filter(Boolean);
    if (kids.length === 0) continue;
    const minX = Math.min(...kids.map((k) => k.x));
    const minY = Math.min(...kids.map((k) => k.y));
    if (minX !== 0 || minY !== 0) {
      g.x += minX;
      g.y += minY;
      for (const k of kids) {
        k.x -= minX;
        k.y -= minY;
      }
    }
    g.width = Math.max(1, round(Math.max(...kids.map((k) => k.x + k.width))));
    g.height = Math.max(1, round(Math.max(...kids.map((k) => k.y + k.height))));
  }
}

/** Line up the children of every auto layout frame, and fit groups around their contents. */
export function relayout(doc: Doc): Doc {
  const frames = Object.values(doc.elements).filter((e) => e.layout);
  const hasGroups = Object.values(doc.elements).some((e) => e.type === "group");
  if (frames.length === 0 && !hasGroups) return doc;
  const next = structuredClone(doc);
  fitGroups(next);
  const mine = frames.map((f) => next.elements[f.id]);
  // inner frames first, so a frame that hugs its content knows its size before its parent uses it
  const byDepth = [...mine].sort((a, b) => depthOf(next, b) - depthOf(next, a));
  for (const f of byDepth) layoutFrame(next, f, false);
  // then outer frames first, so "fill" and "stretch" sizes flow downwards
  for (const f of [...byDepth].reverse()) layoutFrame(next, f, true);
  // and once more inside out, now that the sizes have settled
  for (const f of byDepth) layoutFrame(next, f, false);
  fitGroups(next);
  return next;
}
