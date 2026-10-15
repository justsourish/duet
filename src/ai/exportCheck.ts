/** What an AI may ask for when it saves a frame as a picture. Plain checks, so they can be tested alone. */

export interface ExportAsk {
  path: string;
  scale: number;
}

/** The cleaned-up request, or the reason it cannot be done. */
export function checkExport(rawPath: unknown, rawScale: unknown, width: number, height: number): ExportAsk | { error: string } {
  const path = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!/^(~[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(path)) return { error: "Give the full path of the new file, starting from the top folder or from ~ for the home folder." };
  if (!/\.png$/i.test(path)) return { error: "The file name must end in .png." };
  if (path.split(/[\\/]/).some((part, i) => part === ".." || (i > 0 && part.startsWith(".")))) return { error: "Hidden folders and .. are not allowed in the path. Choose a normal folder." };
  const scale = rawScale == null ? 1 : rawScale;
  if (typeof scale !== "number" || !(scale >= 0.25 && scale <= 4)) return { error: "scale must be a number from 0.25 to 4." };
  if (Math.max(width, height) * scale > 8192) return { error: "That would be over 8192 pixels on the long side. Use a smaller scale." };
  return { path, scale };
}
