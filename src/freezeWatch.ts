import { logError } from "./errorLog";
import { getState, subscribe } from "./state/store";

/**
 * Notes in ~/.duet/errors.log when the window stops answering for a while, with the last few things
 * that happened before it, so a freeze that comes and goes can be found later.
 */

const STEP = 500;
const STOPPED = 2000;
const before: string[] = [];

const note = (what: string) => {
  before.push(`${new Date().toISOString().slice(11, 23)} ${what}`);
  if (before.length > 12) before.shift();
};

export function watchForFreezes() {
  let last = performance.now();
  let lastLength = getState().timeline.length;
  subscribe(() => {
    const s = getState();
    if (s.timeline.length === lastLength) return;
    lastLength = s.timeline.length;
    note(`change: ${s.timeline[s.timeline.length - 1]?.label ?? ""}`);
  });
  for (const ev of ["pointerdown", "keydown", "drop", "paste"]) window.addEventListener(ev, () => note(ev), true);
  // when the window last went behind another app
  let away = -Infinity;
  window.addEventListener("blur", () => (away = performance.now()));
  setInterval(() => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    // a hidden window, or one behind another app, is slowed on purpose by the system, which is not a freeze
    if (gap < STOPPED || document.visibilityState !== "visible" || !document.hasFocus() || away > now - gap) return;
    const s = getState();
    const doc = s.timeline[s.cursor]?.doc;
    logError(
      "window stopped",
      `for ${(gap / 1000).toFixed(1)} s. ${Object.keys(doc?.elements ?? {}).length} things on the canvas, step ${s.cursor + 1} of ${s.timeline.length}.\nBefore it:\n${before.join("\n")}`,
    );
  }, STEP);
}
