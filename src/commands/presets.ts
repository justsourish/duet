import type { Doc } from "../document/types";
import { runCommand } from "./index";

export interface FramePreset {
  name: string;
  width: number;
  height: number;
}

/** Standard preset frame sizes. */
export const FRAME_PRESETS: FramePreset[] = [
  { name: "Phone", width: 390, height: 844 },
  { name: "Tablet", width: 820, height: 1180 },
  { name: "Desktop", width: 1440, height: 900 },
  { name: "Poster", width: 1080, height: 1350 },
  { name: "Square post", width: 1080, height: 1080 },
  { name: "Story", width: 1080, height: 1920 },
  { name: "Video", width: 1920, height: 1080 },
  { name: "Slide", width: 1920, height: 1080 },
];

export interface CreatePresetFrameArgs {
  preset: FramePreset;
  center?: { x: number; y: number };
  x?: number;
  y?: number;
  id?: string;
}

/**
 * Pure function: creates a new frame of the given preset size.
 * Centers the frame if center is passed; otherwise places it at x, y (or 0, 0).
 * Never mutates the input document.
 */
export function createPresetFrame(doc: Doc, args: CreatePresetFrameArgs): Doc {
  const x = args.x ?? (args.center ? Math.round(args.center.x - args.preset.width / 2) : 0);
  const y = args.y ?? (args.center ? Math.round(args.center.y - args.preset.height / 2) : 0);
  return runCommand(doc, "create_element", {
    type: "frame",
    id: args.id,
    x,
    y,
    width: args.preset.width,
    height: args.preset.height,
    props: { name: args.preset.name },
  });
}
