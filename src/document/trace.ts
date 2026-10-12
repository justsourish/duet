import type { AbsNode } from "./path";

/**
 * Tracing: turn the solid parts of a picture into drawn shapes. Our own code, start to finish.
 *
 * It works on pictures with a plain or see-through background. Each separate part becomes one flat
 * shape in its average colour. Holes are filled in, because a drawn shape is one outline.
 */

interface P {
  x: number;
  y: number;
}

/** One traced part: its outline in picture pixels, how many pixels it covers, and its average colour. */
export interface TracedShape {
  nodes: AbsNode[];
  area: number;
  color: string;
}

/** Why a picture could not be traced, in words for the designer. */
export class TraceError extends Error {}

/**
 * Which pixels belong to the subject. A picture with see-through parts uses those. Otherwise the
 * colour around the edge is taken as the background, and anything clearly different is the subject.
 */
export function foreground(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const total = w * h;
  const mask = new Uint8Array(total);
  let clear = 0;
  for (let i = 0; i < total; i++) if (rgba[i * 4 + 3] < 128) clear++;
  let count = 0;
  if (clear > total * 0.005) {
    for (let i = 0; i < total; i++) if (rgba[i * 4 + 3] >= 128) mask[i] = 1;
  } else {
    // the background is whatever runs around the edge of the picture
    const edge: number[] = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
    const mean = [0, 0, 0];
    for (const i of edge) for (let c = 0; c < 3; c++) mean[c] += rgba[i * 4 + c] / edge.length;
    let spread = 0;
    for (const i of edge) spread += (Math.abs(rgba[i * 4] - mean[0]) + Math.abs(rgba[i * 4 + 1] - mean[1]) + Math.abs(rgba[i * 4 + 2] - mean[2])) / edge.length;
    if (spread > 60) throw new TraceError("This picture has a busy background. Tracing works on pictures with a plain or see-through background.");
    const far = Math.max(72, spread * 3);
    for (let i = 0; i < total; i++) {
      if (Math.abs(rgba[i * 4] - mean[0]) + Math.abs(rgba[i * 4 + 1] - mean[1]) + Math.abs(rgba[i * 4 + 2] - mean[2]) > far) mask[i] = 1;
    }
  }
  for (let i = 0; i < total; i++) count += mask[i];
  if (count < total * 0.002) throw new TraceError("There is nothing in this picture that stands out from its background.");
  if (count > total * 0.98) throw new TraceError("This picture fills its whole box, so there is no outline to trace. Tracing works on pictures with a plain or see-through background.");
  return mask;
}

/** Give every separate part its own number. Parts that only touch at a corner are separate. */
function label(mask: Uint8Array, w: number, h: number): { labels: Int32Array; areas: number[]; starts: number[] } {
  const labels = new Int32Array(w * h);
  const areas: number[] = [0];
  const starts: number[] = [-1];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = areas.length;
    let area = 0;
    labels[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % w;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) (labels[p - 1] = id), stack.push(p - 1);
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) (labels[p + 1] = id), stack.push(p + 1);
      if (p >= w && mask[p - w] && !labels[p - w]) (labels[p - w] = id), stack.push(p - w);
      if (p < w * (h - 1) && mask[p + w] && !labels[p + w]) (labels[p + w] = id), stack.push(p + w);
    }
    areas.push(area);
    starts.push(i); // the first pixel met, reading left to right and top to bottom
  }
  return { labels, areas, starts };
}

/** Walk around the outside of one part, along the edges between pixels, keeping the part on the right. */
function walk(labels: Int32Array, w: number, h: number, id: number, start: number): P[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  // for each heading (east, south, west, north): the step, and the pixels ahead on the left and on the right
  const step = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const left = [[0, -1], [0, 0], [-1, 0], [-1, -1]];
  const right = [[0, 0], [-1, 0], [-1, -1], [0, -1]];
  const sx = start % w;
  const sy = Math.floor(start / w);
  // Start at the top-left corner of the part's first pixel and head east along its top edge. Only that
  // one pixel of the part touches this corner, so coming back to it means the whole way round is done.
  const out: P[] = [{ x: sx, y: sy }];
  let x = sx + 1;
  let y = sy;
  let d = 0;
  for (let guard = 0; guard < w * h * 4 + 16 && !(x === sx && y === sy); guard++) {
    let next = (d + 1) % 4; // nothing ahead: turn right, around the corner of the pixel beside us
    if (inside(x + left[d][0], y + left[d][1])) next = (d + 3) % 4;
    else if (inside(x + right[d][0], y + right[d][1])) next = d;
    if (next !== d) out.push({ x, y });
    d = next;
    x += step[d][0];
    y += step[d][1];
  }
  return out;
}

const gap = (p: P, a: P, b: P) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Keep only the points that matter: drop any that sit within `slack` of the line between its neighbours. */
function thin(points: P[], slack: number): P[] {
  const keep = (list: P[]): P[] => {
    if (list.length < 3) return list;
    let worst = 0;
    let at = 0;
    for (let i = 1; i < list.length - 1; i++) {
      const g = gap(list[i], list[0], list[list.length - 1]);
      if (g > worst) (worst = g), (at = i);
    }
    if (worst <= slack) return [list[0], list[list.length - 1]];
    return [...keep(list.slice(0, at + 1)).slice(0, -1), ...keep(list.slice(at))];
  };
  // a closed outline has no ends, so cut it at its two furthest-apart points and thin each half
  let far = 0;
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y) > Math.hypot(points[far].x - points[0].x, points[far].y - points[0].y)) far = i;
  if (far === 0) return points;
  const a = keep(points.slice(0, far + 1));
  const b = keep([...points.slice(far), points[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Points to a smooth outline: gentle bends get curve handles, sharp bends stay as corners. */
function smooth(points: P[]): AbsNode[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const node: AbsNode = { x: p.x, y: p.y, ix: 0, iy: 0, ox: 0, oy: 0 };
    if (!inLen || !outLen) return node;
    const along = ((p.x - prev.x) * (next.x - p.x) + (p.y - prev.y) * (next.y - p.y)) / (inLen * outLen);
    if (along < 0.45) return node; // a bend sharper than about 63 degrees is a corner
    // Points along a curve sit close together where it bends. A clear bend between two long straight
    // runs is the corner of a straight-sided shape, and stays a corner.
    if (Math.min(inLen, outLen) * Math.acos(Math.min(1, along)) > 30) return node;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    node.ox = (tx * outLen) / 3;
    node.oy = (ty * outLen) / 3;
    node.ix = (-tx * inLen) / 3;
    node.iy = (-ty * inLen) / 3;
    return node;
  });
}

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/**
 * Trace a picture's pixels into shapes, biggest first. The outlines are in picture pixels.
 * Throws a TraceError, with a sentence for the designer, when the picture is not one it can trace.
 */
export function traceShapes(rgba: Uint8ClampedArray, w: number, h: number, most = 24): TracedShape[] {
  const mask = foreground(rgba, w, h);
  const { labels, areas, starts } = label(mask, w, h);
  // specks are noise, not shapes
  const smallest = Math.max(12, w * h * 0.0008);
  const ids = areas.map((_, i) => i).filter((i) => i > 0 && areas[i] >= smallest);
  ids.sort((a, b) => areas[b] - areas[a]);
  const sums = new Map<number, [number, number, number]>(ids.slice(0, most).map((i) => [i, [0, 0, 0]]));
  for (let i = 0; i < w * h; i++) {
    const s = sums.get(labels[i]);
    if (!s) continue;
    s[0] += rgba[i * 4];
    s[1] += rgba[i * 4 + 1];
    s[2] += rgba[i * 4 + 2];
  }
  const out: TracedShape[] = [];
  for (const id of ids.slice(0, most)) {
    const corners = walk(labels, w, h, id, starts[id]);
    // pixel steps are smoothed away first; fewer points are kept if the outline is very long
    let points = thin(corners, 1.8);
    for (let slack = 2.6; points.length > 200; slack *= 1.5) points = thin(corners, slack);
    if (points.length < 3) continue;
    const s = sums.get(id)!;
    out.push({ nodes: smooth(points), area: areas[id], color: `#${hex(s[0] / areas[id])}${hex(s[1] / areas[id])}${hex(s[2] / areas[id])}` });
  }
  if (out.length === 0) throw new TraceError("There is nothing in this picture big enough to trace.");
  return out;
}
