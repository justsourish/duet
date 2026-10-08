import type { Rect } from "../document/types";

export type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: { key: HandleKey; fx: number; fy: number; cursor: string }[] = [
  { key: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { key: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { key: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { key: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { key: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { key: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { key: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { key: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

/** New rectangle after dragging a handle by (dx, dy). Flips cleanly past the opposite edge. */
export function resizeRect(orig: Rect, key: HandleKey, dx: number, dy: number): Rect {
  let left = orig.x;
  let right = orig.x + orig.width;
  let top = orig.y;
  let bottom = orig.y + orig.height;
  if (key.includes("w")) left += dx;
  if (key.includes("e")) right += dx;
  if (key.includes("n")) top += dy;
  if (key.includes("s")) bottom += dy;
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(1, Math.abs(right - left)),
    height: Math.max(1, Math.abs(bottom - top)),
  };
}
