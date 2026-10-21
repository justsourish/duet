import { invoke } from "@tauri-apps/api/core";
import { logError } from "../errorLog";

/** What a clip looks like along its bar on the timeline: small frames of its picture, and how loud its sound is. */
export type Strip = { path: string; step: number; count: number; width: number; height: number };

/** Seconds of a file each loudness value stands for. Matches the Rust side. */
export const PEAK_SLICE = 0.05;

const strips = new Map<string, Promise<Strip | null>>();
const peaks = new Map<string, Promise<Uint8Array | null>>();
const inApp = () => "__TAURI_INTERNALS__" in window;

/** Asked once for each file. Null when it cannot be made, and the bar stays plain. */
export function stripOf(src: string): Promise<Strip | null> {
  if (!src || !inApp()) return Promise.resolve(null);
  let p = strips.get(src);
  if (!p) {
    p = invoke<Strip>("clip_strip", { path: src }).catch((e) => {
      logError("clip frames", e);
      return null;
    });
    strips.set(src, p);
  }
  return p;
}

export function peaksOf(src: string): Promise<Uint8Array | null> {
  if (!src || !inApp()) return Promise.resolve(null);
  let p = peaks.get(src);
  if (!p) {
    p = invoke<number[]>("clip_peaks", { path: src })
      .then((a) => new Uint8Array(a))
      .catch((e) => {
        logError("clip loudness", e);
        return null;
      });
    peaks.set(src, p);
  }
  return p;
}

/** Which frame of a strip shows a second of the file. */
export const frameAt = (s: Strip, fileTime: number) => Math.max(0, Math.min(s.count - 1, Math.floor(fileTime / s.step)));
