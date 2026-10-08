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

export interface ResizeOptions {
  /** Shift: keep the shape's proportions. */
  keepRatio?: boolean;
  /** Option or Alt: grow or shrink from the centre instead of the opposite edge. */
  fromCenter?: boolean;
}

/** New rectangle after dragging a handle by (dx, dy). Flips cleanly past the opposite edge. */
export function resizeRect(orig: Rect, key: HandleKey, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  const ox = orig.x;
  const oy = orig.y;
  const ow = orig.width;
  const oh = orig.height;
  const cx = ox + ow / 2;
  const cy = oy + oh / 2;
  const hasX = key.includes("w") || key.includes("e");
  const hasY = key.includes("n") || key.includes("s");

  let left = ox;
  let right = ox + ow;
  let top = oy;
  let bottom = oy + oh;
  const mirror = !!opts.fromCenter;
  if (key.includes("w")) {
    left += dx;
    if (mirror) right -= dx;
  }
  if (key.includes("e")) {
    right += dx;
    if (mirror) left -= dx;
  }
  if (key.includes("n")) {
    top += dy;
    if (mirror) bottom -= dy;
  }
  if (key.includes("s")) {
    bottom += dy;
    if (mirror) top -= dy;
  }

  if (opts.keepRatio && ow > 0 && oh > 0) {
    const w = right - left;
    const h = bottom - top;
    const sx = Math.abs(w) / ow;
    const sy = Math.abs(h) / oh;
    const s = hasX && hasY ? Math.max(sx, sy) : hasX ? sx : sy;
    const nw = ow * s;
    const nh = oh * s;
    const dirX = hasX && w < 0 ? -1 : 1;
    const dirY = hasY && h < 0 ? -1 : 1;
    if (mirror || !hasX) {
      left = cx - nw / 2;
      right = cx + nw / 2;
    } else if (key.includes("e")) {
      left = ox;
      right = ox + dirX * nw;
    } else {
      right = ox + ow;
      left = right - dirX * nw;
    }
    if (mirror || !hasY) {
      top = cy - nh / 2;
      bottom = cy + nh / 2;
    } else if (key.includes("s")) {
      top = oy;
      bottom = oy + dirY * nh;
    } else {
      bottom = oy + oh;
      top = bottom - dirY * nh;
    }
  }

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(1, Math.abs(right - left)),
    height: Math.max(1, Math.abs(bottom - top)),
  };
}
