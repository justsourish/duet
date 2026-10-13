import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { drawElement } from "../canvas/render";
import { docAt, spanOf } from "../document/time";
import { playsFile } from "../document/types";
import type { Doc } from "../document/types";
import { currentDoc, dispatch, getState, select } from "../state/store";
import { fileLength, holdClips, seekClips } from "./clips";
import { pause } from "./play";

/** A frame that plays: bringing clips into it, and making one video file out of it. */

const KINDS = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];
const SOUNDS = ["mp3", "wav", "m4a", "aac", "aiff", "aif", "ogg", "flac"];
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
  return placeClips(sceneId, picked === null ? [] : Array.isArray(picked) ? picked : [picked]);
}

/** A small line at the bottom of the window while something slow is going on. */
function busy(text: string | null) {
  let el = document.getElementById("busy-note");
  if (!text) return el?.remove();
  if (!el) {
    el = document.createElement("div");
    el.id = "busy-note";
    document.body.appendChild(el);
  }
  el.textContent = text;
}

/**
 * Keep dropped files in the Clips folder beside the projects, and say where each one now is. The
 * window is handed what is in a dropped file but not where it is, and a clip is played from a file.
 */
export async function keepDropped(files: File[]): Promise<string[]> {
  const paths: string[] = [];
  const PART = 8 * 1024 * 1024;
  try {
    for (const file of files) {
      const kept = await invoke<{ path: string; already: boolean }>("clip_keep_begin", { name: file.name, size: file.size });
      if (!kept.already) {
        for (let from = 0; from < file.size; from += PART) {
          busy(`Bringing in ${file.name}, ${Math.round((from / file.size) * 100)}%`);
          await invoke("clip_keep_part", new Uint8Array(await file.slice(from, from + PART).arrayBuffer()));
        }
        await invoke("clip_keep_end");
      }
      paths.push(kept.path);
    }
  } finally {
    busy(null);
  }
  return paths;
}

/** Whether a file is a video or a sound Duet can bring into a scene, going by its name. */
export const clipKind = (path: string): "video" | "sound" | null => {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  return KINDS.includes(ext) ? "video" : SOUNDS.includes(ext) ? "sound" : null;
};

/**
 * Files dropped onto a frame. The frame becomes a scene if it was not one, as long as the first clip.
 * Returns what could not be read.
 */
export async function dropClips(frameId: string, paths: string[]): Promise<string[]> {
  const videos = paths.filter((p) => clipKind(p) === "video");
  const sounds = paths.filter((p) => clipKind(p) === "sound");
  const frame = currentDoc().elements[frameId];
  if (!frame || frame.type !== "frame" || frame.parentId) return ["Drop a clip onto a frame on the page."];
  const problems: string[] = [];
  try {
    if (!(frame.duration > 0)) {
      const length = videos.length ? (await invoke<Info>("video_info", { path: videos[0] })).duration : await fileLength(sounds[0]);
      dispatch("set_duration", { id: frameId, seconds: Math.max(1, Math.round(length * 1000) / 1000) });
    }
  } catch (e) {
    return [String(e instanceof Error ? e.message : e)];
  }
  problems.push(...(await placeClips(frameId, videos)));
  problems.push(...(await placeSounds(frameId, sounds)));
  return problems;
}

/** Put video files in a scene, one after another, starting at the moment the clock is on. Returns what could not be read. */
export async function placeClips(sceneId: string, paths: string[]): Promise<string[]> {
  const problems: string[] = [];
  let at = getState().clock.scene === sceneId ? getState().clock.t : 0;
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

/** Ask for sound files, such as music or a voice, and put them in the frame from the moment the clock is on. They are only heard. */
export async function addSounds(sceneId: string): Promise<string[]> {
  const picked = await open({ multiple: true, title: "Bring in sound", filters: [{ name: "Sound", extensions: SOUNDS }] });
  return placeSounds(sceneId, picked === null ? [] : Array.isArray(picked) ? picked : [picked]);
}

/** Put sound files in a scene, from the moment the clock is on. Returns what could not be read. */
export async function placeSounds(sceneId: string, paths: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const path of paths) {
    try {
      const length = await fileLength(path);
      const scene = currentDoc().elements[sceneId];
      if (!scene) break;
      let at = getState().clock.scene === sceneId ? getState().clock.t : 0;
      if (at >= scene.duration - 0.05) at = 0;
      // music is usually longer than the video: it stops where the video stops, and does not make it longer
      const end = Math.min(scene.duration, Math.round((at + length) * 1000) / 1000);
      const id = `sound-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      dispatch("create_element", { type: "sound", id, parentId: sceneId, x: 0, y: 0, width: 1, height: 1, props: { src: path, name: fileName(path), start: at, end } });
      select([id]);
    } catch (e) {
      problems.push(`${fileName(path)}: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  return problems;
}


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
      if (playsFile(el) && el.src && el.volume > 0) out.push({ path: el.src, from: el.clipFrom + (start - span.start), at: start, length: end - start, volume: el.volume });
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

/** How a video is made: how big, how smooth, how fine, and where it goes. */
export interface ExportChoice {
  /** The longer side of the video in pixels, or 0 to keep the size of the scene. */
  longSide: number;
  fps: number;
  /** ffmpeg's own scale: lower is finer and makes a bigger file. */
  quality: number;
  /** True to be asked where to save. Otherwise it goes to Documents, Duet, Exports. */
  ask: boolean;
  /** A full path, used by the builder tools in place of everything above about where. */
  to?: string;
}

export const SIZES: { name: string; longSide: number }[] = [
  { name: "Same as the scene", longSide: 0 },
  { name: "4K", longSide: 3840 },
  { name: "1080p", longSide: 1920 },
  { name: "720p", longSide: 1280 },
];
export const QUALITIES: { name: string; quality: number }[] = [
  { name: "Best", quality: 15 },
  { name: "Good", quality: 20 },
  { name: "Small file", quality: 27 },
];
export const defaultChoice = (): ExportChoice => ({ longSide: 0, fps: 30, quality: 20, ask: false });

/** The size a scene comes out at for a choice, in even numbers of pixels, as video needs. */
export function exportSize(scene: { width: number; height: number }, longSide: number): [number, number] {
  const k = longSide > 0 ? longSide / Math.max(scene.width, scene.height) : 1;
  const even = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
  return [even(scene.width * k), even(scene.height * k)];
}

/**
 * Make one video file out of a frame that plays. Every picture of it is drawn here, exactly as the
 * canvas draws it, and handed over one by one. Returns the file, or null if the designer backed out.
 */
export async function exportScene(sceneId: string, progress: (done: number) => void, choice: ExportChoice = defaultChoice()): Promise<string | null> {
  const doc = currentDoc();
  const scene = doc.elements[sceneId];
  if (!scene?.duration) throw new Error("This frame has no length yet.");
  let out: string | null;
  if (choice.to) out = choice.to;
  else if (choice.ask) out = await save({ title: "Save your video", defaultPath: `${scene.name}.mp4`, filters: [{ name: "Video", extensions: ["mp4"] }] });
  else {
    // no question asked: it goes beside the projects, named by the scene and the time
    const dir = `${await invoke<string>("default_projects_dir")}/Exports`;
    await invoke("make_dir", { path: dir });
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const safe = scene.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "Video";
    out = `${dir}/${safe} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}.mp4`;
  }
  if (!out) return null;
  const file = out.toLowerCase().endsWith(".mp4") ? out : `${out}.mp4`;
  const FPS = Math.max(1, Math.min(120, Math.round(choice.fps) || 30));
  const [width, height] = exportSize(scene, choice.longSide);
  const scale = width / scene.width;
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
    await invoke("scene_export_begin", { out: file, fps: FPS, seconds: total / FPS, quality: choice.quality, sounds: soundsOf(doc, sceneId) });
    begun = true;
    for (let i = 0; i < total; i++) {
      if (stop) throw new Error("Stopped.");
      const t = i / FPS;
      const now = docAt(doc, sceneId, t);
      await seekClips(doc, sceneId, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      // the scene is drawn at the size asked for, sharp at any size because it is drawn, not stretched
      ctx.setTransform(scale, 0, 0, height / scene.height, 0, 0);
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
