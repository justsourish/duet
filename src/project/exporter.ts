import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { drawElement } from "../canvas/render";
import { topLevelOnly } from "../document/geometry";
import { toSvg } from "../document/svg";
import type { Doc } from "../document/types";
import { currentDoc, getState } from "../state/store";
import { preloadPictures } from "./assets";

export type Format = "png" | "svg";

/** What would be exported: the selection, or every screen when nothing is selected. */
export function exportTargets(doc: Doc, selection: string[]): string[] {
  const picked = topLevelOnly(doc, selection.filter((i) => doc.elements[i]));
  if (picked.length) return picked;
  return doc.rootIds.filter((i) => doc.elements[i]?.type === "frame");
}

/** Draw one element to a PNG at the given scale. Returns base64 text. */
export function renderPng(doc: Doc, id: string, scale: number): string {
  const el = doc.elements[id];
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(el.width * scale));
  canvas.height = Math.max(1, Math.round(el.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the picture.");
  ctx.scale(scale, scale);
  drawElement(ctx, doc, { ...el, x: 0, y: 0 }, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";

/** Names that never collide, like "Home", "Home 2". */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = safe(n);
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? k : `${k} ${c}`;
  });
}

/** Export and tell the designer where it went. Returns a short message. */
export async function exportDesign(format: Format, scale: number): Promise<string> {
  const doc = currentDoc();
  const ids = exportTargets(doc, getState().selection);
  if (ids.length === 0) return "Nothing to export yet. Draw a frame first.";
  await preloadPictures(doc);
  const names = uniqueNames(ids.map((i) => doc.elements[i].name));
  const ext = format;
  const suffix = format === "png" && scale !== 1 ? `@${scale}x` : "";

  const write = async (path: string, id: string) => {
    if (format === "svg") await invoke("write_text_file", { path, contents: toSvg(doc, id) });
    else await invoke("write_binary_file", { path, dataBase64: renderPng(doc, id, scale) });
  };

  try {
    if (ids.length === 1) {
      const path = await save({
        title: "Export",
        defaultPath: `${names[0]}${suffix}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!path) return "";
      const final = path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
      await write(final, ids[0]);
      return `Saved ${final.split(/[\\/]/).pop()}`;
    }
    const dir = await open({ directory: true, multiple: false, title: `Choose a folder for ${ids.length} files` });
    if (typeof dir !== "string") return "";
    for (let i = 0; i < ids.length; i++) await write(`${dir}/${names[i]}${suffix}.${ext}`, ids[i]);
    return `Saved ${ids.length} files to ${dir.split(/[\\/]/).pop()}`;
  } catch (e) {
    await message(String(e), { title: "Duet", kind: "error" });
    return "Could not export.";
  }
}
