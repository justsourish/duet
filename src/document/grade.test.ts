import { describe, expect, it } from "vitest";
import { gradablesIn } from "./grade";

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
