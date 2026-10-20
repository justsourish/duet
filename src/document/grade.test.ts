import { describe, expect, it } from "vitest";
import { cleanCurve, colourAt, curveTable, gradablesIn, withColour, isNeutral, mergeGrade, neutralGrade, noCurves, turn } from "./grade";
import type { CurvePoint } from "./grade";
import gradeFixtures from "./grade-fixtures.json";

describe("gradablesIn", () => {
  it("finds every picture and clip in a scene, inside groups too, and nothing else", () => {
    const doc = {
      elements: {
        s: { id: "s", type: "frame", childIds: ["a", "g", "t"] },
        a: { id: "a", type: "video", childIds: [] },
        g: { id: "g", type: "group", childIds: ["b"] },
        b: { id: "b", type: "image", childIds: [] },
        t: { id: "t", type: "text", childIds: [] },
      },
    };
    expect(gradablesIn(doc, "s")).toEqual(["a", "b"]);
    expect(gradablesIn(doc, "missing")).toEqual([]);
  });
});

describe("the colour maths shared with the export engine", () => {
  it("works out curves exactly as the export engine does", () => {
    for (const c of gradeFixtures.tables) {
      const t = curveTable(c.points as CurvePoint[], c.round, c.middle);
      c.at.forEach((i, n) => expect(t[i]).toBeCloseTo(c.values[n], 5));
    }
  });

  it("turns colours round the wheel exactly as the export engine does, and greys stay grey", () => {
    for (const c of gradeFixtures.turns) {
      const out = turn(c.in as [number, number, number], c.deg);
      out.forEach((v, i) => expect(v).toBeCloseTo(c.out[i], 5));
    }
    turn([0.4, 0.4, 0.4], 77).forEach((v) => expect(v).toBeCloseTo(0.4, 6));
  });

  it("keeps curve points tidy and leaves a grade with no curves neutral", () => {
    expect(cleanCurve([[0.5, 2], [0.2, 0.1], [0.2, 0.3], "x", [NaN, 1]])).toEqual([[0.2, 0.1], [0.5, 1]]);
    expect(isNeutral(neutralGrade())).toBe(true);
    expect(isNeutral({ ...neutralGrade(), curves: { ...noCurves(), red: [[0, 0], [1, 0.9]] } })).toBe(false);
    expect(mergeGrade(null, { hue: 500 })?.hue).toBe(180);
    expect(mergeGrade(null, { curves: { light: [[0, 0.1], [1, 1]] } })?.curves.light).toEqual([[0, 0.1], [1, 1]]);
  });
});

describe("one colour", () => {
  it("moves only the picked colour and can take the change away again", () => {
    let pts = withColour([], 0.6, 0.8);
    expect(colourAt(pts, 0.6)).toBe(0.8);
    expect(curveTable(pts, true)[Math.round(0.3 * 255)]).toBeCloseTo(0.5, 6);
    pts = withColour(pts, 0.0, 0.3);
    expect(colourAt(pts, 0)).toBe(0.3);
    expect(colourAt(pts, 0.6)).toBe(0.8);
    // red reaches round the end of the wheel
    expect(pts.some((p) => p[0] > 0.9)).toBe(true);
    pts = withColour(pts, 0.6, 0.5);
    expect(colourAt(pts, 0.6)).toBe(0.5);
    expect(withColour(pts, 0, 0.5)).toEqual([]);
  });
});
