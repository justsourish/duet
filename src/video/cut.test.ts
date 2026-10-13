import { describe, expect, it } from "vitest";
import { addClip, emptyCut, moveClip, removeClip, setShape, sizeOf, timeText, totalLength, trimClip } from "./cut";

const info = { duration: 10, width: 1920, height: 1080, sound: true };

function three() {
  let cut = emptyCut();
  cut = addClip(cut, "/v/one.mp4", info, "a");
  cut = addClip(cut, "/v/two.mov", { ...info, duration: 4, width: 1080, height: 1920 }, "b");
  cut = addClip(cut, "/v/three.mp4", info, "c");
  return cut;
}

describe("cutting video", () => {
  it("adds a clip whole, named after its file", () => {
    const cut = three();
    expect(cut.clips.map((c) => c.name)).toEqual(["one.mp4", "two.mov", "three.mp4"]);
    expect(cut.clips[1]).toMatchObject({ start: 0, end: 4 });
  });

  it("removes and reorders", () => {
    expect(removeClip(three(), "b").clips.map((c) => c.id)).toEqual(["a", "c"]);
    expect(moveClip(three(), "c", 0).clips.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(moveClip(three(), "a", 99).clips.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(moveClip(three(), "nope", 0)).toEqual(three());
  });

  it("keeps the kept part inside the file", () => {
    const cut = trimClip(three(), "a", { start: -3, end: 50 });
    expect(cut.clips[0]).toMatchObject({ start: 0, end: 10 });
  });

  it("never lets the kept part vanish: the edge being moved gives way", () => {
    const moved = trimClip(trimClip(three(), "a", { end: 5 }), "a", { start: 8 });
    expect(moved.clips[0].start).toBeCloseTo(4.9);
    expect(moved.clips[0].end).toBe(5);
    const other = trimClip(trimClip(three(), "a", { start: 5 }), "a", { end: 2 });
    expect(other.clips[0].start).toBe(5);
    expect(other.clips[0].end).toBeCloseTo(5.1);
  });

  it("adds up the length of what is kept", () => {
    expect(totalLength(trimClip(three(), "a", { start: 2, end: 5 }))).toBe(3 + 4 + 10);
  });

  it("follows the first clip's shape unless one is picked", () => {
    expect(sizeOf(emptyCut())).toBeNull();
    expect(sizeOf(three())).toEqual([1920, 1080]);
    expect(sizeOf(setShape(three(), "tall"))).toEqual([1080, 1920]);
  });

  it("writes time the way a designer reads it", () => {
    expect(timeText(7.46)).toBe("0:07.5");
    expect(timeText(62)).toBe("1:02.0");
    expect(timeText(-1)).toBe("0:00.0");
  });
});
