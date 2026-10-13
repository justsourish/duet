import { addPictures, getChat } from "./chat";
import type { ToolResult } from "./tools";

/**
 * Pictures and written briefs the designer gives the AI with a message: a screenshot of feedback, a reference, a brief.
 * They live only in the conversation. They are never placed on the canvas or kept in the project.
 */

/** Longest side sent to the AI. Enough to read small text in a screenshot. */
const SEND_SIDE = 1568;
const THUMB_SIDE = 96;
/** How many pictures one message may carry. */
export const MAX_WAITING = 6;
const MAX_BYTES = 30 * 1024 * 1024;

function load(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not a picture"));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, side: number, quality: number): string {
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** A written brief: Markdown or plain text. */
const WRITTEN = /\.(md|markdown|txt)$/i;
const isWritten = (f: File) => WRITTEN.test(f.name) || f.type === "text/plain" || f.type === "text/markdown";
/** The most of a brief the AI is given. Longer ones are cut, and the AI is told. */
const MAX_WORDS = 60000;

/**
 * Take in dropped, pasted or picked files, shrink each picture, and keep them waiting for the next message.
 * Returns a short sentence for the designer if some were left out, or nothing if all went in.
 */
export async function attachFiles(files: File[]): Promise<string | null> {
  const pictures = files.filter((f) => isWritten(f) || f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|heic)$/i.test(f.name));
  if (!pictures.length) return files.length ? "Only pictures and text files can go with a message." : null;
  const room = MAX_WAITING - getChat().pictures.filter((p) => !p.sent).length;
  const ready = [];
  let unread = 0;
  for (const f of pictures.slice(0, Math.max(0, room))) {
    try {
      if (f.size > MAX_BYTES) throw new Error("too big");
      if (isWritten(f)) {
        const words = await f.text();
        ready.push({
          name: f.name || "Pasted text",
          data: "",
          mime: "text/plain",
          width: 0,
          height: 0,
          thumb: "",
          text: words.length > MAX_WORDS ? `${words.slice(0, MAX_WORDS)}\n\n(The rest of this file was left out because it is too long.)` : words,
        });
        continue;
      }
      const img = await load(f);
      ready.push({
        name: f.name || "Pasted picture",
        data: draw(img, SEND_SIDE, 0.9).split(",")[1],
        mime: "image/jpeg",
        width: img.naturalWidth,
        height: img.naturalHeight,
        thumb: draw(img, THUMB_SIDE, 0.8),
      });
    } catch {
      unread++;
    }
  }
  addPictures(ready);
  if (pictures.length > room) return `A message can carry ${MAX_WAITING} files. The rest were left out.`;
  if (unread) return unread === 1 ? "One file could not be read." : `${unread} files could not be read.`;
  return null;
}

/** The AI asks to see one of the pictures, or read one of the briefs, the designer attached. */
export function lookAtAttachment(number: unknown): ToolResult {
  const all = getChat().pictures;
  const pic = all.find((p) => p.n === Number(number));
  if (!pic) {
    const have = all.map((p) => p.n).join(", ");
    return { text: have ? `There is no attached picture with number ${String(number)}. The numbers are: ${have}.` : "The designer has not attached any pictures.", isError: true };
  }
  if (pic.text !== undefined) return { text: `Attached file ${pic.n}, "${pic.name}". The designer attached it to a message for you to read. It is not on the canvas.\n\n${pic.text}` };
  return {
    text: `Attached picture ${pic.n}, "${pic.name}", ${pic.width} by ${pic.height} pixels. The designer attached it to a message for you to look at. It is not on the canvas.`,
    image: { data: pic.data, mime: pic.mime },
  };
}
