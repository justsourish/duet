/**
 * Words tied to steps: every step in a project's history has a short name of its own, and the thread
 * remembers which step a change led to. So a message can show its step, and a step can show the
 * words behind it. A link that cannot be found is simply not shown. It never points at the wrong step.
 */

/** What this needs to know about a step in the history. */
export interface Step {
  /** The step's own name. */
  step?: string;
  /** Names of quick steps that were saved together with this one. */
  covers?: string[];
}

/** A new name for a step. Short, and never the same twice in one project. */
export function newStepId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const NAME = /^[0-9a-f]{6,64}$/;

/** The line kept with a saved step: the names of the steps it holds, its own name last. Empty when there are none. */
export function stepsLine(names: string[]): string {
  const clean = [...new Set(names.filter((n) => NAME.test(n)))];
  return clean.length ? `Steps: ${clean.join(" ")}` : "";
}

/** Where in the history a step is now, or -1 if it is no longer there. */
export function findStep(timeline: Step[], name: string | undefined): number {
  if (!name) return -1;
  const own = timeline.findIndex((e) => e.step === name);
  return own >= 0 ? own : timeline.findIndex((e) => e.covers?.includes(name));
}

/** What the designer asked for that led to this step, or null when the step did not come from the conversation. */
export function wordsBehind(said: { role: string; text: string; step?: string }[], step: Step): string | null {
  const names = [step.step, ...(step.covers ?? [])].filter(Boolean);
  if (!names.length) return null;
  const at = said.findIndex((m) => m.step !== undefined && names.includes(m.step));
  if (at < 0) return null;
  for (let i = at - 1; i >= 0; i--) {
    if (said[i].role === "break") return null;
    if (said[i].role === "you") return said[i].text.trim() || null;
  }
  return null;
}
