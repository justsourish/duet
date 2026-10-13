import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { docAt, valueAt } from "./time";
import { emptyDoc } from "./types";

function scene() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "create_element", { type: "rect", id: "r", parentId: "f", x: 100, y: 100, width: 200, height: 100 });
  doc = runCommand(doc, "create_element", { type: "text", id: "t", parentId: "f", x: 100, y: 400, width: 200, height: 40 });
  return runCommand(doc, "set_duration", { id: "f", seconds: 10 });
}

describe("time", () => {
  it("holds the ends and eases in between", () => {
    const keys = [
      { t: 1, v: 0, ease: "linear" as const },
      { t: 3, v: 100, ease: "linear" as const },
    ];
    expect(valueAt(keys, 0)).toBe(0);
    expect(valueAt(keys, 2)).toBe(50);
    expect(valueAt(keys, 9)).toBe(100);
  });

  it("only a frame on the page can play", () => {
    const doc = scene();
    expect(doc.elements.f.duration).toBe(10);
    expect(runCommand(doc, "set_duration", { id: "r", seconds: 5 })).toBe(doc);
  });

  it("shows a thing only between the second it appears and the second it leaves", () => {
    const doc = runCommand(scene(), "set_timing", { ids: ["t"], start: 2, end: 5 });
    expect(docAt(doc, "f", 1).elements.f.childIds).toEqual(["r"]);
    expect(docAt(doc, "f", 2).elements.f.childIds).toEqual(["r", "t"]);
    expect(docAt(doc, "f", 5).elements.f.childIds).toEqual(["r"]);
    // the design itself is untouched
    expect(doc.elements.f.childIds).toEqual(["r", "t"]);
  });

  it("changes a value over time, and leaves the design as it was", () => {
    let doc = runCommand(scene(), "set_key", { ids: ["r"], prop: "x", t: 0, v: 100, ease: "linear" });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "x", t: 4, v: 500, ease: "linear" });
    expect(docAt(doc, "f", 2).elements.r.x).toBe(300);
    expect(doc.elements.r.x).toBe(100);
    doc = runCommand(doc, "remove_key", { ids: ["r"], prop: "x" });
    expect(doc.elements.r.keys).toEqual({});
  });

  it("moves what a thing does along with it when its start moves", () => {
    let doc = runCommand(scene(), "set_entrance", { ids: ["t"], when: "in", kind: "fade", seconds: 1 });
    expect(doc.elements.t.keys.opacity?.map((k) => k.t)).toEqual([0, 1]);
    expect(docAt(doc, "f", 0).elements.t.opacity).toBe(0);
    doc = runCommand(doc, "set_timing", { ids: ["t"], start: 3 });
    expect(doc.elements.t.keys.opacity?.map((k) => k.t)).toEqual([3, 4]);
  });

  it("keeps a still design's file as it was, and brings time back from a saved one", () => {
    const still = runCommand(emptyDoc(), "create_element", { type: "rect", id: "a", x: 0, y: 0, width: 10, height: 10 });
    const text = serializeDoc(still);
    for (const word of ["duration", "start", "end", "keys", "clipFrom", "volume"]) expect(text).not.toContain(`"${word}"`);
    const doc = runCommand(runCommand(scene(), "set_timing", { ids: ["t"], start: 2, end: 5 }), "set_entrance", { ids: ["t"], when: "in", kind: "slide-up" });
    const back = parseDoc(serializeDoc(doc));
    expect(back.elements.f.duration).toBe(10);
    expect(back.elements.t.start).toBe(2);
    expect(back.elements.t.keys).toEqual(doc.elements.t.keys);
  });
});
