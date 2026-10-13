import { convertFileSrc } from "@tauri-apps/api/core";
import { spanOf } from "../document/time";
import type { Doc } from "../document/types";
import { logError } from "../errorLog";

/**
 * The players behind video clips on the canvas. Each file has one hidden player. The canvas draws
 * whatever picture that player is on, so a clip is kept in step with the clock from here.
 */

const players = new Map<string, HTMLVideoElement>();
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

function player(src: string): HTMLVideoElement {
  let v = players.get(src);
  if (v) return v;
  v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.preload = "auto";
  v.playsInline = true;
  v.src = convertFileSrc(src);
  for (const ev of ["loadeddata", "seeked"]) v.addEventListener(ev, () => changed());
  v.addEventListener("error", () => logError("clip", new Error(`This clip could not be played: ${src}`)));
  players.set(src, v);
  return v;
}

/** The picture a clip is on right now, or null while it is not ready. */
export function clipPicture(src: string): HTMLVideoElement | null {
  if (!src) return null;
  const v = player(src);
  return v.readyState >= 2 ? v : null;
}

/** How long a clip's file is, in seconds, or 0 while that is not known yet. */
export const clipLength = (src: string) => (src ? player(src).duration || 0 : 0);

const clipsIn = (doc: Doc, sceneId: string) => {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      if (doc.elements[c]?.type === "video") out.push(c);
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
        if (Math.abs(v.currentTime - at) > 0.25) v.currentTime = at;
        if (v.paused) void v.play().catch((e) => logError("clip", e));
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - at) > 0.02) v.currentTime = at;
      }
    }
  }
  for (const [src, v] of players) if (!live.has(src) && !v.paused) v.pause();
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
    const v = player(el.src);
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
