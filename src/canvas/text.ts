export const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`;
export const LINE_HEIGHT = 1.3;

let scratch: CanvasRenderingContext2D | null = null;

export function measureText(text: string, fontSize: number, weight = 400): { width: number; height: number } {
  const lines = text.split("\n");
  if (!scratch) scratch = document.createElement("canvas").getContext("2d");
  let width = 0;
  if (scratch) {
    scratch.font = `${weight} ${fontSize}px ${FONT_STACK}`;
    for (const l of lines) width = Math.max(width, scratch.measureText(l).width);
  } else {
    width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55;
  }
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
}
