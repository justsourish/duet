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

/** Take points out. Keeps at least two points on an open line and three on a closed one. */
export function removeNodes(nodes: AbsNode[], closed: boolean, indices: number[]): AbsNode[] {
  const toRemove = new Set(indices.filter((i) => i >= 0 && i < nodes.length));
  if (toRemove.size === 0) return nodes;
  const min = closed ? 3 : 2;
  if (nodes.length - toRemove.size < min) return nodes;
  return nodes.filter((_, k) => !toRemove.has(k));
}

/** Take a point out. Keeps at least two points on an open line and three on a closed one. */
export function removeNode(nodes: AbsNode[], closed: boolean, index: number): AbsNode[] {
  return removeNodes(nodes, closed, [index]);
}

// ---- reading an outline written as SVG path text ----

/** One unbroken piece of an outline. */
export interface Piece {
  nodes: AbsNode[];
  closed: boolean;
}

const HOW_MANY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** A curved corner of an ellipse, as the cubic curves that draw it. Each is [handle, handle, end]. */
function arcToCurves(x1: number, y1: number, rx: number, ry: number, turn: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [];
  const phi = (turn * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const px = cos * dx + sin * dy;
  const py = -sin * dx + cos * dy;
  // radii that are too small to reach are grown until they do
  const grow = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const top = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top) / (rx * rx * py * py + ry * ry * px * px));
  const cxp = (k * rx * py) / ry;
  const cyp = (-k * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (px - cxp) / rx, (py - cyp) / ry);
  let sweepBy = angle((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
  if (!sweep && sweepBy > 0) sweepBy -= Math.PI * 2;
  if (sweep && sweepBy < 0) sweepBy += Math.PI * 2;
  const parts = Math.max(1, Math.ceil(Math.abs(sweepBy) / (Math.PI / 2) - 1e-9));
  const step = sweepBy / parts;
  const reach = (4 / 3) * Math.tan(step / 4);
  const at = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const along = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: number[][] = [];
  for (let i = 0; i < parts; i++) {
    const t1 = start + i * step;
    const t2 = t1 + step;
    const a = at(t1);
    const b = i === parts - 1 ? { x: x2, y: y2 } : at(t2);
    const da = along(t1);
    const db = along(t2);
    out.push([a.x + reach * da.x, a.y + reach * da.y, b.x - reach * db.x, b.y - reach * db.y, b.x, b.y]);
  }
  return out;
}

/**
 * Read SVG path text (the d of a path) into points and handles. Every move (M) starts a new piece.
 * Lines, curves and arcs are understood, in capital (exact) and small (from the last point) letters.
 * Throws a plain sentence when the text cannot be read.
 */
export function parsePathData(d: string): Piece[] {
  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  let i = 0;
  const space = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = (): number => {
    space();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) throw new Error(`The outline has something that is not a number near "${d.slice(Math.max(0, i - 8), i + 8).trim()}".`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  // the two yes-or-no marks of an arc may be written with no space between them
  const flag = (): boolean => {
    space();
    if (d[i] !== "0" && d[i] !== "1") throw new Error("An arc (A) needs 0 or 1 for its two marks, after the turn angle.");
    return d[i++] === "1";
  };

  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // the last handle, for the smooth curves S and T
  let hx = 0;
  let hy = 0;
  let last = "";
  let cmd = "";
  let total = 0;

  const point = (px: number, py: number) => {
    if (!cur) begin(x, y);
    if (++total > 4000) throw new Error("The outline has too many points. Keep it under 4000.");
    cur!.nodes.push({ x: px, y: py, ix: 0, iy: 0, ox: 0, oy: 0 });
    x = px;
    y = py;
  };
  const begin = (px: number, py: number) => {
    cur = { nodes: [], closed: false };
    pieces.push(cur);
    startX = px;
    startY = py;
    point(px, py);
  };
  const curve = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
    if (!cur) begin(x, y);
    const from = cur!.nodes[cur!.nodes.length - 1];
    from.ox = ax - from.x;
    from.oy = ay - from.y;
    point(px, py);
    const to = cur!.nodes[cur!.nodes.length - 1];
    to.ix = bx - px;
    to.iy = by - py;
  };

  for (;;) {
    space();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) {
      cmd = d[i++];
      if (!(cmd.toLowerCase() in HOW_MANY)) throw new Error(`The outline uses "${cmd}", which is not a path letter. Use M, L, H, V, C, S, Q, T, A and Z.`);
      if (cmd.toLowerCase() === "z") {
        if (cur) (cur as Piece).closed = true;
        x = startX;
        y = startY;
        cur = null;
        last = "z";
        continue;
      }
    } else if (!cmd || cmd.toLowerCase() === "z") {
      throw new Error("The outline must start with M and a point, like M 0 0.");
    }
    const low = cmd.toLowerCase();
    const rel = cmd === low;
    const bx = rel ? x : 0;
    const by = rel ? y : 0;
    if (low === "m") {
      begin(bx + number(), by + number());
      cmd = rel ? "l" : "L"; // more points after a move are lines
    } else if (!pieces.length) {
      throw new Error("The outline must start with M and a point, like M 0 0.");
    } else if (low === "l") point(bx + number(), by + number());
    else if (low === "h") point(bx + number(), y);
    else if (low === "v") point(x, by + number());
    else if (low === "c") {
      const n = [number(), number(), number(), number(), number(), number()];
      hx = bx + n[2];
      hy = by + n[3];
      curve(bx + n[0], by + n[1], hx, hy, bx + n[4], by + n[5]);
    } else if (low === "s") {
      const n = [number(), number(), number(), number()];
      const ax = last === "c" || last === "s" ? 2 * x - hx : x;
      const ay = last === "c" || last === "s" ? 2 * y - hy : y;
      hx = bx + n[0];
      hy = by + n[1];
      curve(ax, ay, hx, hy, bx + n[2], by + n[3]);
    } else if (low === "q" || low === "t") {
      let qx: number;
      let qy: number;
      if (low === "q") {
        qx = bx + number();
        qy = by + number();
      } else {
        qx = last === "q" || last === "t" ? 2 * x - hx : x;
        qy = last === "q" || last === "t" ? 2 * y - hy : y;
      }
      const px = bx + number();
      const py = by + number();
      hx = qx;
      hy = qy;
      curve(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
    } else if (low === "a") {
      const rx = number();
      const ry = number();
      const turn = number();
      const large = flag();
      const sweep = flag();
      const px = bx + number();
      const py = by + number();
      const curves = arcToCurves(x, y, rx, ry, turn, large, sweep, px, py);
      if (curves.length === 0) point(px, py);
      for (const c of curves) curve(c[0], c[1], c[2], c[3], c[4], c[5]);
    }
    last = low;
  }

  for (const p of pieces) {
    const curved = (n: AbsNode) => !!(n.ix || n.iy || n.ox || n.oy);
    const meets = () => p.nodes.length > 1 && Math.hypot(p.nodes[0].x - p.nodes[p.nodes.length - 1].x, p.nodes[0].y - p.nodes[p.nodes.length - 1].y) < 1e-6;
    if (!p.closed) continue;
    // a loop made of one curve needs a point in the middle before its two ends can be joined
    if (meets() && p.nodes.length === 2 && p.nodes.some(curved)) p.nodes = splitSegment(p.nodes, false, 0, 0.5).nodes;
    if (meets()) {
      const end = p.nodes.pop()!;
      p.nodes[0].ix = end.ix;
      p.nodes[0].iy = end.iy;
    }
    // a closed shape is kept as three points or more
    if (p.nodes.length === 2 && p.nodes.some(curved)) p.nodes = splitSegment(p.nodes, true, 0, 0.5).nodes;
    if (p.nodes.length < 3) p.closed = false;
  }
  return pieces.filter((p) => p.nodes.length >= 2);
}

/** The box that holds exactly what is drawn. Curve handles may reach outside it. */
export function drawnBox(nodes: AbsNode[], closed: boolean): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  // the furthest a curve reaches along one direction: its ends, and where it turns back
  const reach = (out: number[], p0: number, p1: number, p2: number, p3: number) => {
    out.push(p0, p3);
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    const at = (t: number) => {
      if (t <= 0 || t >= 1) return;
      const u = 1 - t;
      out.push(u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3);
    };
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) > 1e-9) at(-c / b);
      return;
    }
    const root = b * b - 4 * a * c;
    if (root < 0) return;
    at((-b + Math.sqrt(root)) / (2 * a));
    at((-b - Math.sqrt(root)) / (2 * a));
  };
  if (nodes.length === 1) {
    xs.push(nodes[0].x);
    ys.push(nodes[0].y);
  }
  for (const [i, j] of segments(nodes.length, closed)) {
    const a = nodes[i];
    const b = nodes[j];
    reach(xs, a.x, a.x + a.ox, b.x + b.ix, b.x);
    reach(ys, a.y, a.y + a.oy, b.y + b.iy, b.y);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}

/**
 * One outline from SVG path text, with its box and its points as fractions of that box. The box fits
 * what is drawn, so the shape turns around its own middle. Throws a plain sentence if it cannot be used.
 */
export function outlineFromData(d: string): { x: number; y: number; width: number; height: number; nodes: PathNode[]; closed: boolean } {
  if (typeof d !== "string" || !d.trim()) throw new Error("A path needs d: its outline as SVG path text, like M 0 0 L 100 0 L 50 80 Z.");
  const pieces = parsePathData(d);
  if (pieces.length === 0) throw new Error("The outline needs at least two points.");
  if (pieces.length > 1) throw new Error(`The outline has ${pieces.length} separate pieces. A path holds one piece, with no holes. Make one path for each piece (each M starts a new piece).`);
  const { nodes, closed } = pieces[0];
  const box = drawnBox(nodes, closed);
  return {
    ...box,
    nodes: nodes.map((n) => ({
      x: r4((n.x - box.x) / box.width),
      y: r4((n.y - box.y) / box.height),
      ix: r4(n.ix / box.width),
      iy: r4(n.iy / box.height),
      ox: r4(n.ox / box.width),
      oy: r4(n.oy / box.height),
    })),
    closed,
  };
}
