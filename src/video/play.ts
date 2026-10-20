import { currentDoc, getState, setClock, subscribe } from "../state/store";
import { clockFromClip, onClipPicture, syncClips } from "./clips";

/** Playing a frame that has a length: the clock runs, the canvas follows, and clips keep in step. */

let raf = 0;
let last = 0;

function tick(now: number) {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!s.clock.playing || !scene?.duration) {
    raf = 0;
    if (s.clock.playing) setClock({ playing: false });
    return;
  }
  // a playing clip sets the pace; with none, the clock runs on its own
  const own = s.clock.t + (now - last) / 1000;
  const t = clockFromClip(currentDoc(s), scene.id, s.clock.t) ?? own;
  last = now;
  // with a work area, playing stops at its end
  const stop = scene.workArea ? Math.min(scene.workArea.end, scene.duration) : scene.duration;
  if (t >= stop) {
    raf = 0;
    setClock({ t: stop, playing: false });
    return;
  }
  setClock({ t });
  raf = requestAnimationFrame(tick);
}

export function play() {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!scene?.duration || s.clock.playing) return;
  // pressing play at the end, or outside the work area, starts again from its beginning
  const from = scene.workArea?.start ?? 0;
  const to = scene.workArea ? Math.min(scene.workArea.end, scene.duration) : scene.duration;
  setClock({ playing: true, t: s.clock.t >= to - 0.01 || s.clock.t < from - 0.01 ? from : s.clock.t });
  last = performance.now();
  if (!raf) raf = requestAnimationFrame(tick);
}

export const pause = () => setClock({ playing: false });
export const togglePlay = () => (getState().clock.playing ? pause() : play());

/** Jump to a moment. */
export function seek(t: number) {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!scene) return;
  setClock({ t: Math.max(0, Math.min(scene.duration, t)) });
}

/** Open a frame that plays on the clock, or close the clock with null. */
export function openScene(id: string | null) {
  const s = getState();
  if (s.clock.scene === id) return;
  setClock({ scene: id, t: 0, playing: false });
}

let wired = false;
/** Keep the clips in step with the clock from now on. Called once when the app starts. */
export function wireClips() {
  if (wired) return;
  wired = true;
  let was = "";
  subscribe(() => {
    const s = getState();
    const doc = currentDoc(s);
    const now = `${s.clock.scene}|${s.clock.t}|${s.clock.playing}`;
    if (now === was && doc === lastDoc) return;
    was = now;
    lastDoc = doc;
    syncClips(doc, s.clock.scene, s.clock.t, s.clock.playing);
  });
  // a new picture from a clip means the canvas has to draw again
  onClipPicture(() => setClock({}));
}
let lastDoc: unknown = null;
