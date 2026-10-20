import { describe, expect, it } from "vitest";
import { RULER, gapsAround, rulerSteps, rulerTicks, snapEqualGaps, snapToGuides } from "./guides";

describe("rulers", () => {
  it("marks get finer as you zoom in and never crowd", () => {
    expect(rulerSteps(1)).toEqual({ minor: 10, major: 100 });
    expect(rulerSteps(8).minor).toBe(1);
    expect(rulerSteps(0.1).minor).toBe(100);
    for (const z of [0.05, 0.2, 0.5, 1, 2, 5, 20]) {
      const { minor, major } = rulerSteps(z);
      expect(minor * z).toBeGreaterThanOrEqual(8);
      expect(major).toBeGreaterThanOrEqual(minor);
      expect(major % minor).toBe(0);
    }
  });
  it("lists the marks in view, with a number on every major one", () => {
    const ticks = rulerTicks(-5, 205, 1);
    expect(ticks[0].at).toBe(-10);
    expect(ticks.filter((t) => t.major).map((t) => t.at)).toEqual([0, 100, 200]);
    expect(RULER).toBeGreaterThan(0);
  });
});

describe("guides", () => {
  it("snap the edges and middle of a box to a ruler guide", () => {
    const box = { x: 97, y: 0, width: 50, height: 10 };
    const s = snapToGuides(box, { x: [100, 300], y: [] }, 6);
    expect(s).toEqual({ dx: 3, dy: 0, x: 100, y: null });
    // middle: 97 + 25 = 122, so a guide at 120 pulls it back 2
    expect(snapToGuides(box, { x: [120], y: [] }, 6).dx).toBe(-2);
    expect(snapToGuides(box, { x: [200], y: [] }, 6).x).toBeNull();
    expect(snapToGuides(box, undefined, 6).dx).toBe(0);
  });
});

describe("gaps while moving", () => {
  const box = { x: 100, y: 0, width: 40, height: 40 };
  it("measure the nearest neighbour on each side that shares some height", () => {
    const left = { x: 0, y: 10, width: 70, height: 20 };
    const below = { x: 110, y: 90, width: 10, height: 10 };
    const far = { x: 500, y: 10, width: 10, height: 10 };
    const gaps = gapsAround(box, [left, below, far], 200);
    expect(gaps.find((g) => g.axis === "x")).toEqual({ axis: "x", from: 70, to: 100, at: 20 });
    expect(gaps.find((g) => g.axis === "y")).toEqual({ axis: "y", from: 40, to: 90, at: 115 });
    // far is past the reach
    expect(gapsAround(box, [far], 200)).toEqual([]);
  });
  it("snap to the middle between two neighbours", () => {
    const a = { x: 0, y: 0, width: 50, height: 40 };
    const b = { x: 200, y: 0, width: 50, height: 40 };
    // box between them at x 105: gaps 55 and 55... move it off by 4 so the gaps are 59 and 51
    const off = { x: 109, y: 0, width: 40, height: 40 };
    const out = snapEqualGaps(off, [a, b], 6, 400);
    expect(out.dx).toBe(-4);
    expect(out.gaps.every((g) => g.to - g.from === 55)).toBe(true);
    // too far from equal: no pull
    expect(snapEqualGaps({ ...off, x: 130 }, [a, b], 6, 400).dx).toBe(0);
  });
});
