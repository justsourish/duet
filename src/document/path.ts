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
