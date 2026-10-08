import { currentDoc, getState } from "../state/store";
import { getPicture, preloadPictures } from "../project/assets";
import { renderPng } from "../project/exporter";
import type { ToolResult } from "./tools";

/**
 * Eyes for the AI. It only knows names and numbers until it asks to see something.
 * Pictures are shrunk first, so a look costs about a thousand tokens, not a whole photo.
 */

const DEFAULT_SIDE = 768;
const side = (v: unknown) => Math.max(128, Math.min(1536, typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_SIDE));

/** One picture on the canvas, as the designer placed it. */
export async function lookAtImage(id: unknown, max: unknown): Promise<ToolResult> {
  const doc = currentDoc();
  const el = typeof id === "string" ? doc.elements[id] : undefined;
  if (!el) return { text: `No element with id: ${String(id)}.`, isError: true };
  if (el.type !== "image" || !el.src) return { text: `${el.name} is not a picture. Use look_at_design to see a frame or shape.`, isError: true };
  await preloadPictures(doc);
  const pic = getPicture(el.src);
  if (!pic || !pic.naturalWidth) return { text: `The picture file for ${el.name} could not be found. Ask the designer to save the project and try again.`, isError: true };
  const k = Math.min(1, side(max) / Math.max(pic.naturalWidth, pic.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pic.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(pic.naturalHeight * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { text: "Could not prepare the picture.", isError: true };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(pic, 0, 0, canvas.width, canvas.height);
  return {
    text: `The picture "${el.name}", ${pic.naturalWidth} by ${pic.naturalHeight} pixels, shown at ${canvas.width} by ${canvas.height}. On the canvas it sits at ${Math.round(el.width)} by ${Math.round(el.height)}.`,
    image: { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mime: "image/jpeg" },
  };
}

/** What the design looks like right now: one frame or shape, drawn as the designer sees it. */
export async function lookAtDesign(ids: unknown, max: unknown): Promise<ToolResult> {
  const doc = currentDoc();
  const list = Array.isArray(ids) && ids.length ? ids.map(String) : getState().selection.length ? getState().selection : doc.rootIds.filter((i) => doc.elements[i]?.type === "frame").slice(0, 1);
  const id = list.find((i) => doc.elements[i]);
  if (!id) return { text: "There is nothing to look at yet. Draw or ask for a frame first.", isError: true };
  const el = doc.elements[id];
  await preloadPictures(doc);
  const k = Math.min(1, side(max) / Math.max(el.width, el.height));
  const data = renderPng(doc, id, k);
  return {
    text: `A picture of "${el.name}" (${Math.round(el.width)} by ${Math.round(el.height)} pixels), shown at ${Math.round(el.width * k)} by ${Math.round(el.height * k)}.${list.length > 1 ? " Only the first one is shown. Ask again for the others." : ""}`,
    image: { data, mime: "image/png" },
  };
}
