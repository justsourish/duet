import type { El, PathNode } from "./types";

/** A point on a drawn line, in pixels. ix, iy and ox, oy are how far its two curve handles reach. */
export interface AbsNode {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Pixels, anywhere on the page, from the saved fractions of the element's box. */
export function toAbs(el: El, x0: number, y0: number): AbsNode[] {
  return (el.nodes ?? []).map((n) => ({
    x: x0 + n.x * el.width,
    y: y0 + n.y * el.height,
    ix: n.ix * el.width,
    iy: n.iy * el.height,
    ox: n.ox * el.width,
    oy: n.oy * el.height,
  }));
}

/** The box that holds the whole line, and the points as fractions of that box. */
export function fromAbs(nodes: AbsNode[]): { x: number; y: number; width: number; height: number; nodes: PathNode[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) {
    xs.push(n.x, n.x + n.ix, n.x + n.ox);
    ys.push(n.y, n.y + n.iy, n.y + n.oy);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - x);
  const height = Math.max(1, Math.max(...ys) - y);
  return {
    x,
    y,
    width,
    height,
    nodes: nodes.map((n) => ({
      x: r4((n.x - x) / width),
      y: r4((n.y - y) / height),
      ix: r4(n.ix / width),
      iy: r4(n.iy / height),
      ox: r4(n.ox / width),
      oy: r4(n.oy / height),
    })),
  };
}

interface Pen {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  closePath(): void;
}

const straight = (a: AbsNode, b: AbsNode) => !a.ox && !a.oy && !b.ix && !b.iy;

/** Draw the line onto a canvas context (or anything shaped like one). */
export function trace(pen: Pen, nodes: AbsNode[], closed: boolean) {
  if (nodes.length === 0) return;
  pen.moveTo(nodes[0].x, nodes[0].y);
  const seg = (a: AbsNode, b: AbsNode) => {
    if (straight(a, b)) pen.lineTo(b.x, b.y);
    else pen.bezierCurveTo(a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y);
  };
  for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 2) {
    seg(nodes[nodes.length - 1], nodes[0]);
    pen.closePath();
  }
}

/** The line as SVG path text. */
export function pathData(nodes: AbsNode[], closed: boolean): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  let d = "";
  trace(
    {
      moveTo: (x, y) => (d += `M${n(x)} ${n(y)}`),
      lineTo: (x, y) => (d += `L${n(x)} ${n(y)}`),
      bezierCurveTo: (a, b, c, e, f, g) => (d += `C${n(a)} ${n(b)} ${n(c)} ${n(e)} ${n(f)} ${n(g)}`),
      closePath: () => (d += "Z"),
    },
    nodes,
    closed,
  );
  return d;
}

/** The line as many short straight pieces, good enough for finding what is under the pointer. */
export function flatten(nodes: AbsNode[], closed: boolean, steps = 14): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let last: { x: number; y: number } | null = null;
  trace(
    {
      moveTo: (x, y) => {
        out.push({ x, y });
        last = { x, y };
      },
      lineTo: (x, y) => {
        out.push({ x, y });
        last = { x, y };
      },
      bezierCurveTo: (ax, ay, bx, by, x, y) => {
        const p0 = last ?? { x, y };
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          out.push({
            x: u * u * u * p0.x + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x,
            y: u * u * u * p0.y + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y,
          });
        }
        last = { x, y };
      },
      closePath: () => {
        if (out.length) out.push({ ...out[0] });
      },
    },
    nodes,
    closed,
  );
  return out;
}

/** How far a point is from the nearest piece of the line. */
export function distanceToLine(px: number, py: number, line: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)));
  }
  return best;
}

// ---- editing the points of an existing line ----

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Segments as pairs of point numbers: 0-1, 1-2, and the closing one when the shape is closed. */
export function segments(count: number, closed: boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < count; i++) out.push([i, i + 1]);
  if (closed && count > 2) out.push([count - 1, 0]);
  return out;
}

const pointOn = (a: AbsNode, b: AbsNode, t: number): { x: number; y: number } => {
  if (straight(a, b)) return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  const u = 1 - t;
  const p1x = a.x + a.ox;
  const p1y = a.y + a.oy;
  const p2x = b.x + b.ix;
  const p2y = b.y + b.iy;
  return {
    x: u * u * u * a.x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * b.y,
  };
};

/** The closest spot on the line to a point: which piece, how far along it, and how far away. */
export function nearestOnLine(nodes: AbsNode[], closed: boolean, px: number, py: number) {
  let best = { segment: -1, t: 0, distance: Infinity };
  segments(nodes.length, closed).forEach(([i, j], s) => {
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const q = pointOn(nodes[i], nodes[j], t);
      const d = Math.hypot(px - q.x, py - q.y);
      if (d < best.distance) best = { segment: s, t, distance: d };
    }
  });
  return best;
}

/** Add a point on a piece of the line, keeping the shape exactly as it was. */
export function splitSegment(nodes: AbsNode[], closed: boolean, segment: number, t: number): { nodes: AbsNode[]; index: number } {
  const [i, j] = segments(nodes.length, closed)[segment];
  const a = nodes[i];
  const b = nodes[j];
  let made: AbsNode;
  let na = a;
  let nb = b;
  if (straight(a, b)) {
    made = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), ix: 0, iy: 0, ox: 0, oy: 0 };
  } else {
    const p = [a.x, a.y, a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y];
    const q0 = [lerp(p[0], p[2], t), lerp(p[1], p[3], t)];
    const q1 = [lerp(p[2], p[4], t), lerp(p[3], p[5], t)];
    const q2 = [lerp(p[4], p[6], t), lerp(p[5], p[7], t)];
    const r0 = [lerp(q0[0], q1[0], t), lerp(q0[1], q1[1], t)];
    const r1 = [lerp(q1[0], q2[0], t), lerp(q1[1], q2[1], t)];
    const s = [lerp(r0[0], r1[0], t), lerp(r0[1], r1[1], t)];
    made = { x: s[0], y: s[1], ix: r0[0] - s[0], iy: r0[1] - s[1], ox: r1[0] - s[0], oy: r1[1] - s[1] };
    na = { ...a, ox: q0[0] - a.x, oy: q0[1] - a.y };
    nb = { ...b, ix: q2[0] - b.x, iy: q2[1] - b.y };
  }
  const out = nodes.map((n, k) => (k === i ? na : k === j ? nb : n));
  // the closing piece goes after the last point; every other piece goes right after its first point
  const at = j === 0 ? out.length : i + 1;
  out.splice(at, 0, made);
  return { nodes: out, index: at };
}

/** Does this point have two handles pointing in opposite directions (a smooth join)? */
export function isSmooth(n: AbsNode): boolean {
  const a = Math.hypot(n.ix, n.iy);
  const b = Math.hypot(n.ox, n.oy);
  if (!a || !b) return false;
  const cross = Math.abs(n.ix * n.oy - n.iy * n.ox) / (a * b);
  return cross < 0.02 && n.ix * n.ox + n.iy * n.oy < 0;
}

/** Corner to smooth, or smooth back to corner. */
export function toggleSmooth(nodes: AbsNode[], closed: boolean, index: number): AbsNode[] {
  const n = nodes[index];
  if (n.ix || n.iy || n.ox || n.oy) return nodes.map((m, k) => (k === index ? { ...m, ix: 0, iy: 0, ox: 0, oy: 0 } : m));
  const prev = nodes[index - 1] ?? (closed ? nodes[nodes.length - 1] : undefined);
  const next = nodes[index + 1] ?? (closed ? nodes[0] : undefined);
  const a = prev ?? n;
  const b = next ?? n;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return nodes;
  dx /= len;
  dy /= len;
  const reachOut = next ? Math.hypot(next.x - n.x, next.y - n.y) / 3 : len / 3;
  const reachIn = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : len / 3;
  return nodes.map((m, k) => (k === index ? { ...m, ox: dx * reachOut, oy: dy * reachOut, ix: -dx * reachIn, iy: -dy * reachIn } : m));
}

/** Take a point out. Keeps at least two points on an open line and three on a closed one. */
export function removeNode(nodes: AbsNode[], closed: boolean, index: number): AbsNode[] {
  if (nodes.length <= (closed ? 3 : 2)) return nodes;
  return nodes.filter((_, k) => k !== index);
}
