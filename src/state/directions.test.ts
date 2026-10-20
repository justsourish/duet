import { describe, expect, it } from "vitest";
import { childOf, directionOf, lineTo, parentOf, startsDirection } from "./directions";

// a b c d, then back at b: e f
const timeline = [{ step: "a" }, { step: "b" }, { step: "c" }, { step: "d" }, { step: "e", from: "b" }, { step: "f" }];

describe("directions", () => {
  it("knows where each step came from", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => parentOf(timeline, i))).toEqual([-1, 0, 1, 2, 1, 4]);
    expect(startsDirection(timeline, 4)).toBe(true);
    expect(startsDirection(timeline, 3)).toBe(false);
  });

  it("redo goes to the newest step made on this one", () => {
    expect(childOf(timeline, 1)).toBe(4);
    expect(childOf(timeline, 2)).toBe(3);
    expect(childOf(timeline, 5)).toBe(-1);
  });

  it("finds the line to a step and the whole direction it is on", () => {
    expect(lineTo(timeline, 5)).toEqual([0, 1, 4, 5]);
    expect([...directionOf(timeline, 1)]).toEqual([0, 1, 4, 5]);
    expect([...directionOf(timeline, 2)]).toEqual([0, 1, 2, 3]);
  });

  it("finds a step saved together with another", () => {
    const saved = [{ step: "a" }, { step: "c", covers: ["b"] }, { step: "d", from: "b" }];
    expect(parentOf(saved, 2)).toBe(1);
  });

  it("a step it came from that is gone falls back to the one before", () => {
    expect(parentOf([{ step: "a" }, { step: "b", from: "zz" }], 1)).toBe(0);
  });
});
