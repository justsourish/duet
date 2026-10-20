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
}

export type GradeNumber = Exclude<keyof Grade, "look">;

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
  return GRADE_CONTROLS.every((c) => c.key === "lookAmount" || g[c.key] === 0) && (!g.look || g.lookAmount === 0);
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
  return isNeutral(g) ? null : g;
}

/** Only what differs from the neutral grade, for showing to an AI. */
export function gradeChanges(g: Grade | null | undefined): Partial<Grade> {
  if (!g) return {};
  const n = neutralGrade();
  return Object.fromEntries(Object.entries(g).filter(([k, v]) => n[k as keyof Grade] !== v)) as Partial<Grade>;
}
