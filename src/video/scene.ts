import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { drawElement } from "../canvas/render";
import { docAt, spanOf } from "../document/time";
import type { Doc } from "../document/types";
import { currentDoc, dispatch, getState, select } from "../state/store";
import { holdClips, seekClips } from "./clips";
import { pause } from "./play";

/** A frame that plays: bringing clips into it, and making one video file out of it. */

const KINDS = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

interface Info {
  duration: number;
  width: number;
  height: number;
  sound: boolean;
}

/** Ask for video files and put them in the frame, starting at the moment the clock is on. Returns what could not be read. */
export async function addClips(sceneId: string): Promise<string[]> {
  const picked = await open({ multiple: true, title: "Bring in clips", filters: [{ name: "Video", extensions: KINDS }] });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const problems: string[] = [];
  let at = getState().clock.t;
  for (const path of paths) {
    try {
      const info = await invoke<Info>("video_info", { path });
      const scene = currentDoc().elements[sceneId];
      if (!scene) break;
      if (at >= scene.duration - 0.05) at = 0;
      const end = Math.round((at + info.duration) * 1000) / 1000;
      // the frame grows to hold a clip that runs past its end
      if (end > scene.duration) dispatch("set_duration", { id: sceneId, seconds: end });
      const k = Math.min(scene.width / info.width, scene.height / info.height);
      const width = Math.round(info.width * k);
      const height = Math.round(info.height * k);
      const id = `video-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      dispatch("create_element", {
        type: "video",
        id,
        parentId: sceneId,
        x: Math.round((scene.width - width) / 2),
        y: Math.round((scene.height - height) / 2),
        width,
        height,
        props: { src: path, name: fileName(path), start: at, end },
      });
      select([id]);
      at = end;
    } catch (e) {
      problems.push(`${fileName(path)}: ${String(e)}`);
    }
  }
  return problems;
}

const FPS = 30;

/** The sound of every clip in a frame: which file, from where in it, when it is heard, and how loud. */
export function soundsOf(doc: Doc, sceneId: string) {
  const scene = doc.elements[sceneId];
  const out: { path: string; from: number; at: number; length: number; volume: number }[] = [];
  const walk = (id: string, from: number, to: number) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      const el = doc.elements[c];
      if (!el) continue;
      const span = spanOf(el, scene);
      // a clip inside a group is heard only while the group shows
      const start = Math.max(span.start, from);
      const end = Math.min(span.end, to);
      if (end <= start) continue;
      if (el.type === "video" && el.src && el.volume > 0) out.push({ path: el.src, from: el.clipFrom + (start - span.start), at: start, length: end - start, volume: el.volume });
      walk(c, start, end);
    }
  };
  if (scene) walk(sceneId, 0, scene.duration);
  return out;
}

let stop = false;
/** Give up on the video being made. */
export const stopExport = () => {
  stop = true;
};

/**
 * Make one video file out of a frame that plays. Every picture of it is drawn here, exactly as the
 * canvas draws it, and handed over one by one. Returns the file, or null if the designer backed out.
 */
export async function exportScene(sceneId: string, progress: (done: number) => void, to?: string): Promise<string | null> {
  const doc = currentDoc();
  const scene = doc.elements[sceneId];
  if (!scene?.duration) throw new Error("This frame has no length yet.");
  const out = to ?? await save({ title: "Save your video", defaultPath: `${scene.name}.mp4`, filters: [{ name: "Video", extensions: ["mp4"] }] });
  if (!out) return null;
  const file = out.toLowerCase().endsWith(".mp4") ? out : `${out}.mp4`;
  // video needs even numbers of pixels
  const width = Math.round(scene.width) - (Math.round(scene.width) % 2);
  const height = Math.round(scene.height) - (Math.round(scene.height) % 2);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("The video could not be drawn.");
  const total = Math.max(1, Math.round(scene.duration * FPS));
  stop = false;
  pause();
  holdClips(true);
  let begun = false;
  try {
    await invoke("scene_export_begin", { out: file, fps: FPS, seconds: total / FPS, sounds: soundsOf(doc, sceneId) });
    begun = true;
    for (let i = 0; i < total; i++) {
      if (stop) throw new Error("Stopped.");
      const t = i / FPS;
      const now = docAt(doc, sceneId, t);
      await seekClips(doc, sceneId, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      const el = now.elements[sceneId];
      drawElement(ctx, now, el, -el.x, -el.y);
      const blob = await new Promise<Blob | null>((r) => sheet.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("A picture of the video could not be made.");
      await invoke("scene_export_frame", new Uint8Array(await blob.arrayBuffer()));
      progress((i + 1) / total);
    }
    await invoke("scene_export_end");
    return file;
  } catch (e) {
    if (begun) await invoke("scene_export_stop").catch(() => {});
    if (stop) return null;
    throw e;
  } finally {
    holdClips(false);
  }
}
