import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { spanOf } from "../document/time";
import { playsFile } from "../document/types";
import type { Doc } from "../document/types";
import { logError } from "../errorLog";

/**
 * The players behind video clips on the canvas. Each file has one hidden player. The canvas draws
 * whatever picture that player is on, so a clip is kept in step with the clock from here.
 *
 * On the canvas a player plays a light copy of the file once Duet has made one: smaller, and quick to
 * jump around in. Making a video uses players on the original file, so nothing is lost in the result.
 */

const players = new Map<string, HTMLMediaElement>();
/** Players on the original files, used only while a video is being made. */
const fullPlayers = new Map<string, HTMLMediaElement>();
/** Files whose light copy has been asked for, so it is asked for once. */
const previewAsked = new Set<string>();
let changed: () => void = () => {};
/** While a video is being made, the players are moved frame by frame and the clock leaves them alone. */
let held = false;

/** Called when a player has a new picture to show, so the canvas can draw again. */
export const onClipPicture = (fn: () => void) => {
  changed = fn;
};

export const holdClips = (on: boolean) => {
  held = on;
};

/** A sound file gets a sound player: the system will not play a file with nothing to see in a video player. */
const SOUND_FILE = /\.(mp3|wav|m4a|aac|aiff?|ogg|flac)$/i;

function makePlayer(src: string, into: Map<string, HTMLMediaElement>): HTMLMediaElement {
  const sound = SOUND_FILE.test(src);
  const v = document.createElement(sound ? "audio" : "video");
  v.crossOrigin = "anonymous";
  v.preload = "auto";
  if (v instanceof HTMLVideoElement) v.playsInline = true;
  v.src = convertFileSrc(src);
  for (const ev of ["loadeddata", "seeked"]) v.addEventListener(ev, () => changed());
  v.addEventListener("seeked", () => seekedNext(v));
  // the light copy may be what failed, so the address it was really playing is named
  v.addEventListener("error", () => logError("clip", new Error(`This clip could not be played (${v.error?.code ?? "?"} ${v.error?.message ?? ""}): ${v.currentSrc || src}`)));
  into.set(src, v);
  return v;
}

function player(src: string): HTMLMediaElement {
  const v = players.get(src) ?? makePlayer(src, players);
  askPreview(src, v);
  return v;
}

const fullPlayer = (src: string) => fullPlayers.get(src) ?? makePlayer(src, fullPlayers);

/** Have Duet make the light copy in the background, then move the player over to it where it was. */
function askPreview(src: string, v: HTMLMediaElement) {
  // a sound is already light, and has no picture to make smaller
  if (SOUND_FILE.test(src) || previewAsked.has(src) || !("__TAURI_INTERNALS__" in window)) return;
  previewAsked.add(src);
  invoke<string>("clip_preview", { path: src })
    .then((copy) => {
      const at = v.currentTime;
      const wasPlaying = !v.paused;
      v.addEventListener(
        "loadedmetadata",
        () => {
          v.currentTime = at;
          if (wasPlaying) void v.play().catch(() => undefined);
        },
        { once: true },
      );
      v.src = convertFileSrc(copy);
    })
    // without a copy the original keeps playing, as before
    .catch((e) => logError("clip preview", e));
}

/** The picture a clip is on right now, or null while it is not ready. */
export function clipPicture(src: string): HTMLVideoElement | null {
  if (!src) return null;
  const v = held ? fullPlayer(src) : player(src);
  return v instanceof HTMLVideoElement && v.readyState >= 2 ? v : null;
}

// ---- scrubbing: one jump at a time, and only to where the playhead is now ----

/** Where each player should be, and where its jump in flight is heading. */
const wanted = new Map<HTMLMediaElement, number>();
const heading = new Map<HTMLMediaElement, number>();
const settleTimers = new Map<HTMLMediaElement, ReturnType<typeof setTimeout>>();

function jump(v: HTMLMediaElement, at: number, quick: boolean) {
  heading.set(v, at);
  // a quick jump lands on the nearest picture that is fast to show; the exact one follows when the hand stops
  if (quick && typeof v.fastSeek === "function") v.fastSeek(at);
  else v.currentTime = at;
}

function seekedNext(v: HTMLMediaElement) {
  const want = wanted.get(v);
  if (want === undefined || want === heading.get(v)) return;
  jump(v, want, true);
}

/** Move a paused player to a moment. Called on every move of the playhead while scrubbing. */
function seekTo(v: HTMLMediaElement, at: number) {
  wanted.set(v, at);
  if (!v.seeking) jump(v, at, true);
  clearTimeout(settleTimers.get(v));
  settleTimers.set(
    v,
    setTimeout(() => {
      if (Math.abs(v.currentTime - at) <= 0.01 || wanted.get(v) !== at) return;
      if (v.seeking) v.addEventListener("seeked", () => wanted.get(v) === at && jump(v, at, false), { once: true });
      else jump(v, at, false);
    }, 150),
  );
}

/** How long a sound or video file is, in seconds. Waits until the file has said so. */
export function fileLength(src: string): Promise<number> {
  const v = player(src);
  if (v.duration > 0 && Number.isFinite(v.duration)) return Promise.resolve(v.duration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(false), 8000);
    function done(ok: boolean) {
      clearTimeout(timer);
      v.removeEventListener("loadedmetadata", yes);
      v.removeEventListener("error", no);
      if (ok && v.duration > 0 && Number.isFinite(v.duration)) resolve(v.duration);
      else {
        players.delete(src);
        reject(new Error("That file could not be played."));
      }
    }
    const yes = () => done(true);
    const no = () => done(false);
    v.addEventListener("loadedmetadata", yes);
    v.addEventListener("error", no);
  });
}

/** What a clip's player is doing, in words. For checking Duet itself. */
export function clipState(src: string): string {
  const v = players.get(src);
  if (!v) return "no player";
  if (v.error) return `failed (${v.error.code})`;
  return `${v.paused ? "paused" : "playing"} at ${Math.round(v.currentTime * 100) / 100}s, ready ${v.readyState}`;
}

/** How long a clip's file is, in seconds, or 0 while that is not known yet. */
export const clipLength = (src: string) => (src ? player(src).duration || 0 : 0);

const clipsIn = (doc: Doc, sceneId: string) => {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      const el = doc.elements[c];
      if (!el || el.hidden) continue;
      if (playsFile(el)) out.push(c);
      walk(c);
    }
  };
  walk(sceneId);
  return out;
};

/** Put every clip of a frame on the picture that belongs to this moment, and play or hold it. */
export function syncClips(doc: Doc, sceneId: string | null, t: number, playing: boolean) {
  if (held) return;
  const live = new Set<string>();
  const scene = sceneId ? doc.elements[sceneId] : null;
  if (scene?.duration) {
    for (const id of clipsIn(doc, scene.id)) {
      const el = doc.elements[id];
      const { start, end } = spanOf(el, scene);
      if (t < start || t >= end || live.has(el.src)) continue;
      live.add(el.src);
      const v = player(el.src);
      const at = t - start + el.clipFrom;
      v.volume = Math.max(0, Math.min(1, el.volume));
      if (playing) {
        // while playing, the clip leads the clock (see clockFromClip); only a big gap means a jump
        if (v.paused || Math.abs(v.currentTime - at) > 1) v.currentTime = at;
        if (v.paused) void v.play().catch((e) => logError("clip", e));
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - at) > 0.02) seekTo(v, at);
      }
    }
  }
  for (const [src, v] of players) if (!live.has(src) && !v.paused) v.pause();
}

/**
 * While a frame plays, the clock follows the clip that is playing, so the clip never has to jump to
 * catch the clock. Returns the frame time the clip is at, or null when no clip is playing.
 */
export function clockFromClip(doc: Doc, sceneId: string, t: number): number | null {
  const scene = doc.elements[sceneId];
  if (!scene?.duration) return null;
  for (const id of clipsIn(doc, sceneId)) {
    const el = doc.elements[id];
    const { start, end } = spanOf(el, scene);
    if (t < start || t >= end) continue;
    const v = players.get(el.src);
    if (!v || v.paused || v.seeking || v.readyState < 3) continue;
    const at = start + v.currentTime - el.clipFrom;
    // a clip that has not started yet, or has run out, does not lead
    if (at < t - 1 || at > t + 1) continue;
    return Math.max(t, at);
  }
  return null;
}

/** Move every clip of a frame to one moment and wait until its picture is there. Used when a video is made. */
export async function seekClips(doc: Doc, sceneId: string, t: number) {
  const scene = doc.elements[sceneId];
  const waits: Promise<void>[] = [];
  const done = new Set<string>();
  for (const id of clipsIn(doc, sceneId)) {
    const el = doc.elements[id];
    const { start, end } = spanOf(el, scene);
    if (t < start || t >= end || done.has(el.src)) continue;
    done.add(el.src);
    const v = fullPlayer(el.src);
    v.pause();
    const at = Math.min(t - start + el.clipFrom, (v.duration || Infinity) - 0.001);
    waits.push(
      new Promise<void>((resolve) => {
        const ready = () => v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - at) < 0.001;
        if (ready()) return resolve();
        const timer = setTimeout(finish, 4000);
        function finish() {
          clearTimeout(timer);
          v.removeEventListener("seeked", finish);
          v.removeEventListener("loadeddata", onLoad);
          resolve();
        }
        function onLoad() {
          v.currentTime = at;
        }
        v.addEventListener("seeked", finish);
        if (v.readyState >= 1) v.currentTime = at;
        else v.addEventListener("loadeddata", onLoad);
      }),
    );
  }
  await Promise.all(waits);
}
