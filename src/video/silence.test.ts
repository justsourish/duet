import { describe, expect, it } from "vitest";
import { emptyDoc } from "../document/types";
import { runCommand } from "../commands";
import { findSilences } from "./silence";

function talk() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 100, height: 100 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 6 });
  doc = runCommand(doc, "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/talk.mov", start: 0, end: 6 } });
  // loud for 2 seconds, quiet for 2, loud for 2, in slices of 0.05 s
  const loud = new Uint8Array(120).map((_, i) => (i >= 40 && i < 80 ? 5 : 200));
  return { doc, peaks: new Map([["/talk.mov", loud]]) };
}

describe("cutting silences", () => {
  it("finds a pause and leaves a little quiet on each side", () => {
    const { doc, peaks } = talk();
    expect(findSilences(doc, "f", peaks, { quiet: 40, shortest: 0.5, keep: 0.1 })).toEqual([{ start: 2.1, end: 3.9 }]);
  });

  it("a pause shorter than the shortest stays", () => {
    const { doc, peaks } = talk();
    expect(findSilences(doc, "f", peaks, { quiet: 40, shortest: 3, keep: 0.1 })).toEqual([]);
  });

  it("cutting the pauses takes them out and closes the gap", () => {
    const { doc } = talk();
    const out = runCommand(doc, "cut_ranges", { sceneId: "f", ranges: [{ start: 2.1, end: 3.9 }] });
    expect(out.elements.f.duration).toBe(4.2);
    const clips = out.elements.f.childIds.map((id) => out.elements[id]);
    expect(clips.map((c) => [c.start, c.end, c.clipFrom ?? 0])).toEqual([
      [0, 2.1, 0],
      [2.1, 4.2, 3.9],
    ]);
    expect(doc.elements.f.duration).toBe(6);
  });
});
