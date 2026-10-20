/**
 * Directions. Going back and changing something never throws the later steps away: the new change
 * starts a new direction from the step it was made on, and the old one stays. The history keeps every
 * step in the order it happened; each step knows the one it came from, so undo and redo follow the
 * direction you are on.
 */

/** What this needs to know about a step. */
export interface Branching {
  step?: string;
  covers?: string[];
  /** The step this one was made on, when that is not the one just before it. */
  from?: string;
}

const parentsKept = new WeakMap<readonly Branching[], number[]>();

/** For every step, the step it came from. -1 for the first. */
export function parents(timeline: readonly Branching[]): number[] {
  const kept = parentsKept.get(timeline);
  if (kept) return kept;
  const where = new Map<string, number>();
  const out = timeline.map((e, i) => {
    const p = e.from !== undefined ? where.get(e.from) : undefined;
    for (const n of [e.step, ...(e.covers ?? [])]) if (n && !where.has(n)) where.set(n, i);
    return i === 0 ? -1 : (p ?? i - 1);
  });
  parentsKept.set(timeline, out);
  return out;
}

export const parentOf = (timeline: readonly Branching[], i: number): number => parents(timeline)[i] ?? -1;

/** The newest step made on this one, or -1 when nothing came after it. */
export function childOf(timeline: readonly Branching[], i: number): number {
  const p = parents(timeline);
  for (let j = p.length - 1; j > i; j--) if (p[j] === i) return j;
  return -1;
}

/** The steps from the first one to this one, oldest first. */
export function lineTo(timeline: readonly Branching[], i: number): number[] {
  const p = parents(timeline);
  const out: number[] = [];
  for (let j = i; j >= 0; j = p[j]) out.push(j);
  return out.reverse();
}

/** The direction this step is on: every step from the first to the newest one that grew from it. */
export function directionOf(timeline: readonly Branching[], i: number): Set<number> {
  const p = parents(timeline);
  const newest: number[] = new Array(p.length).fill(-1);
  for (let j = 1; j < p.length; j++) if (p[j] >= 0) newest[p[j]] = j;
  let tip = i;
  while (tip >= 0 && newest[tip] >= 0) tip = newest[tip];
  return new Set(lineTo(timeline, tip));
}

/** Whether a new direction starts at this step. */
export const startsDirection = (timeline: readonly Branching[], i: number): boolean => i > 0 && parentOf(timeline, i) !== i - 1;
