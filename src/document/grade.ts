/**
 * The colour of a picture or a video clip. Every control is a plain number, so a designer's slider and
 * an AI ask for exactly the same thing. 0 everywhere, and no look, means the picture is left as it is.
 *
 * The maths lives twice, on purpose: in the preview shader (src/canvas/grade.ts) and in the export
 * engine (src-tauri/src/grade.rs), which works on full-quality frames. Both follow the same steps,
 * and the numbers in grade-fixtures.json are checked against both.
 */

export interface Grade {
  /** Brighter or darker, in stops of light. 1 is twice the light. */
  exposure: number;
  /** -100 to 100. Pulls the darks and lights apart, around the middle grey. */
  contrast: number;
  /** -100 to 100. The bright parts, without moving the darks. */
  highlights: number;
  /** -100 to 100. The dark parts, without moving the lights. */
  shadows: number;
  /** -100 to 100. Only the very brightest parts. */
  whites: number;
  /** -100 to 100. Only the very darkest parts. */
  blacks: number;
  /** -100 to 100. Minus is cooler and bluer, plus is warmer and more orange. */
  temperature: number;
  /** -100 to 100. Minus is greener, plus is more magenta. */
  tint: number;
  /** -100 to 100. Minus takes colour out (-100 is black and white), plus adds it. */
  saturation: number;
  /** -100 to 100. Like saturation, but the dull colours move most and skin moves least. */
  vibrance: number;
  /** A look from a .cube file, kept on this computer, or an empty string for none. */
  look: string;
  /** How much of the look is used, 0 to 1. */
  lookAmount: number;
  /** -180 to 180 degrees. Turns every colour round the colour wheel; greys stay grey. */
  hue: number;
  /** -100 to 100. Minus darkens the edges of the picture, plus lightens them. */
  vignette: number;
  /** Curves, each a list of points from 0 to 1. An empty list leaves that part alone. */
  curves: Curves;
  /** 0 to 100. How much skin keeps its own colour while the rest is changed. */
  skinKeep: number;
  /** -100 to 100. Minus makes skin pinker, plus more golden. Only skin moves. */
  skinTone: number;
  /** -100 to 100. Skin darker or brighter. Only skin moves. */
  skinLight: number;
}

/** A point on a curve: x is what comes in, y what goes out, both 0 to 1. */
export type CurvePoint = [number, number];

/**
 * Light, red, green and blue map brightness in to brightness out. The others are read along the colour
 * wheel (hueHue, hueSat, hueLight, x is the hue) or along brightness (lightSat), and 0.5 means no change.
 */
export interface Curves {
  light: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
  hueHue: CurvePoint[];
  hueSat: CurvePoint[];
  hueLight: CurvePoint[];
  lightSat: CurvePoint[];
}

export const CURVE_KEYS = ["light", "red", "green", "blue", "hueHue", "hueSat", "hueLight", "lightSat"] as const;
export type CurveKey = (typeof CURVE_KEYS)[number];
/** Curves read round the colour wheel: the end joins the start. */
export const ROUND_CURVES: CurveKey[] = ["hueHue", "hueSat", "hueLight"];
/** Curves where 0.5 is no change, rather than the straight line. */
export const MIDDLE_CURVES: CurveKey[] = ["hueHue", "hueSat", "hueLight", "lightSat"];
/** What a change asks for: only the controls and the curves that change. */
export type GradeChange = Partial<Omit<Grade, "curves">> & { curves?: Partial<Curves> };

export const noCurves = (): Curves => ({ light: [], red: [], green: [], blue: [], hueHue: [], hueSat: [], hueLight: [], lightSat: [] });

export type GradeNumber = Exclude<keyof Grade, "look" | "curves">;

/** The controls, in the order they are worked through and shown, with their ranges. */
export const GRADE_CONTROLS: { key: GradeNumber; label: string; min: number; max: number; step: number; group: "light" | "colour" | "look" }[] = [
  { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1, group: "colour" },
  { key: "tint", label: "Tint", min: -100, max: 100, step: 1, group: "colour" },
  { key: "exposure", label: "Exposure", min: -5, max: 5, step: 0.05, group: "light" },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, group: "light" },
  { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1, group: "light" },
  { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1, group: "light" },
  { key: "whites", label: "Whites", min: -100, max: 100, step: 1, group: "light" },
  { key: "blacks", label: "Blacks", min: -100, max: 100, step: 1, group: "light" },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, group: "colour" },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, group: "colour" },
  { key: "lookAmount", label: "Look strength", min: 0, max: 1, step: 0.01, group: "look" },
  { key: "hue", label: "Hue", min: -180, max: 180, step: 1, group: "colour" },
  { key: "vignette", label: "Vignette", min: -100, max: 100, step: 1, group: "light" },
  { key: "skinKeep", label: "Keep skin natural", min: 0, max: 100, step: 1, group: "colour" },
  { key: "skinTone", label: "Skin tone", min: -100, max: 100, step: 1, group: "colour" },
  { key: "skinLight", label: "Skin brightness", min: -100, max: 100, step: 1, group: "light" },
];

export const neutralGrade = (): Grade => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  look: "",
  lookAmount: 1,
  hue: 0,
  vignette: 0,
  curves: noCurves(),
  skinKeep: 0,
  skinTone: 0,
  skinLight: 0,
});

/** Things whose colour can be graded. */
export const canGrade = (el: { type: string }) => el.type === "image" || el.type === "video";

type Tree = { elements: Record<string, { id: string; type: string; childIds?: string[] }> };

/** Every picture and clip inside a frame, the frame's own first. Used to grade them all at once. */
export function gradablesIn(doc: Tree, rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const el = doc.elements[id];
    if (!el) return;
    if (canGrade(el)) out.push(id);
    el.childIds?.forEach(walk);
  };
  walk(rootId);
  return out;
}

/** True when the grade leaves the picture as it was. */
export function isNeutral(g: Grade | null | undefined): boolean {
  if (!g) return true;
  const curves = g.curves ?? noCurves();
  return GRADE_CONTROLS.every((c) => c.key === "lookAmount" || (g[c.key] ?? 0) === 0) && (!g.look || g.lookAmount === 0) && CURVE_KEYS.every((k) => !curves[k]?.length);
}

/**
 * A grade with every number inside its range, from what was there and what was asked for.
 * Anything unknown or not a number is ignored. Returns null when nothing is left to change.
 */
export function mergeGrade(was: Grade | null | undefined, asked: Partial<Record<keyof Grade, unknown>>): Grade | null {
  const g = { ...neutralGrade(), ...(was ?? {}) };
  for (const c of GRADE_CONTROLS) {
    const v = asked[c.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    g[c.key] = Math.round(Math.min(c.max, Math.max(c.min, v)) * 1000) / 1000;
  }
  if (typeof asked.look === "string") g.look = asked.look;
  if (asked.curves && typeof asked.curves === "object") {
    const given = asked.curves as Partial<Record<CurveKey, unknown>>;
    g.curves = { ...noCurves(), ...(g.curves ?? {}) };
    for (const k of CURVE_KEYS) if (k in given) g.curves[k] = cleanCurve(given[k]);
  }
  return isNeutral(g) ? null : g;
}

/** Only what differs from the neutral grade, for showing to an AI. */
export function gradeChanges(g: Grade | null | undefined): Partial<Grade> {
  if (!g) return {};
  const n = neutralGrade();
  const out = Object.fromEntries(Object.entries(g).filter(([k, v]) => k !== "curves" && n[k as keyof Grade] !== v)) as Partial<Grade>;
  const used = CURVE_KEYS.filter((k) => g.curves?.[k]?.length);
  if (used.length) out.curves = Object.fromEntries(used.map((k) => [k, g.curves[k]])) as unknown as Curves;
  return out;
}

/** Points kept inside 0 to 1, sorted, at most 16, no two at the same place. Anything else is dropped. */
export function cleanCurve(v: unknown): CurvePoint[] {
  if (!Array.isArray(v)) return [];
  const pts = v
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)))
    .map(([x, y]) => [Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000, Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000] as CurvePoint)
    .sort((a, b) => a[0] - b[0]);
  return pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0]).slice(0, 16);
}

/*
 * The maths below runs three times: here (to make the tables the preview shader reads), in the shader
 * itself (src/canvas/grade.ts) and in the export engine (src-tauri/src/grade.rs). Keep them in step;
 * grade-fixtures.json checks the tables and pixels of all of them.
 */

/** How many steps a curve is worked out at. */
export const CURVE_STEPS = 256;

/**
 * A curve as a table of CURVE_STEPS values. Tone curves bend smoothly through their points without
 * overshooting (monotone cubic), and run straight on from the end points. Round curves join their end to
 * their start and ease between points (cosine). No points: the straight line, or 0.5 where that means no change.
 */
export function curveTable(points: CurvePoint[], round: boolean, middle = round): Float32Array {
  const n = CURVE_STEPS;
  const out = new Float32Array(n);
  const pts = points;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    if (!pts.length) out[i] = middle ? 0.5 : x;
    else if (round) out[i] = roundAt(pts, x);
    else out[i] = toneAt(pts, x);
  }
  return out;
}

function roundAt(pts: CurvePoint[], x: number): number {
  if (pts.length === 1) return pts[0][1];
  // the next point at or after x, going round
  let j = pts.findIndex((p) => p[0] >= x);
  if (j < 0) j = 0;
  const i = (j - 1 + pts.length) % pts.length;
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[j];
  const span = (x1 - x0 + 1) % 1 || 1;
  const t = Math.min(1, Math.max(0, ((x - x0 + 1) % 1) / span));
  const e = (1 - Math.cos(Math.PI * t)) / 2;
  return y0 + (y1 - y0) * e;
}

function toneAt(pts: CurvePoint[], x: number): number {
  const k = pts.length;
  // one point alone does not make a curve
  if (k === 1) return x;
  if (x <= pts[0][0]) return Math.min(1, Math.max(0, pts[0][1] - (pts[0][0] - x) * slopeAt(pts, 0)));
  if (x >= pts[k - 1][0]) return Math.min(1, Math.max(0, pts[k - 1][1] + (x - pts[k - 1][0]) * slopeAt(pts, k - 1)));
  let i = 0;
  while (pts[i + 1][0] < x) i++;
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  const h = x1 - x0;
  const t = (x - x0) / h;
  const m0 = slopeAt(pts, i);
  const m1 = slopeAt(pts, i + 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
  return Math.min(1, Math.max(0, y));
}

/** The slope at point i, kept so the curve never overshoots its points (Fritsch and Butland). */
function slopeAt(pts: CurvePoint[], i: number): number {
  const k = pts.length;
  const d = (a: number) => (pts[a + 1][1] - pts[a][1]) / (pts[a + 1][0] - pts[a][0]);
  if (i === 0) return d(0);
  if (i === k - 1) return d(k - 2);
  const a = d(i - 1);
  const b = d(i);
  return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
}

/** Colours turned round the wheel by some degrees, around the grey line, so greys stay grey. */
export function turn(v: [number, number, number], deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const u = 0.57735027;
  const d = u * (v[0] + v[1] + v[2]);
  const cross = [u * (v[2] - v[1]), u * (v[0] - v[2]), u * (v[1] - v[0])];
  return [0, 1, 2].map((i) => v[i] * c + cross[i] * s + u * d * (1 - c)) as [number, number, number];
}

/** How far either side of a picked colour a One colour change reaches, round the wheel (0 to 1). */
export const COLOUR_REACH = 0.06;

const roundGap = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
const wrap = (x: number) => Math.round((((x % 1) + 1) % 1) * 1000) / 1000;

/** What a round curve does at one picked colour: its point there, or 0.5 (no change). */
export function colourAt(points: CurvePoint[], hue: number): number {
  return points.find((p) => roundGap(p[0], hue) < 0.001)?.[1] ?? 0.5;
}

/**
 * A round curve with one colour moved to y and left alone a little way either side, so nothing else
 * changes. Other colours already moved on the curve stay as they were. y 0.5 takes the change away.
 */
export function withColour(points: CurvePoint[], hue: number, y: number): CurvePoint[] {
  const c = wrap(hue);
  const kept = points.filter((p) => roundGap(p[0], c) >= COLOUR_REACH - 0.0005);
  const next: CurvePoint[] = Math.abs(y - 0.5) < 0.0005 ? kept : [...kept, [wrap(c - COLOUR_REACH), 0.5], [c, y], [wrap(c + COLOUR_REACH), 0.5]];
  const tidy = cleanCurve(next);
  return tidy.every((p) => Math.abs(p[1] - 0.5) < 0.0005) ? [] : tidy;
}
