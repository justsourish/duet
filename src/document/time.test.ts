import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { docAt, entranceOf, valueAt } from "./time";
import { emptyDoc } from "./types";
import { currentDoc, dispatch, loadDoc, resetStore, seenDoc, setClock, workDoc } from "../state/store";

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

  it("says which ready-made arrival a thing has", () => {
    let doc = runCommand(scene(), "set_timing", { ids: ["t"], start: 2, end: 6 });
    expect(entranceOf(doc.elements.t, doc.elements.f, "in")).toBe("none");
    doc = runCommand(doc, "set_entrance", { ids: ["t"], when: "in", kind: "slide-up" });
    doc = runCommand(doc, "set_entrance", { ids: ["t"], when: "out", kind: "fade" });
    expect(entranceOf(doc.elements.t, doc.elements.f, "in")).toBe("slide-up");
    expect(entranceOf(doc.elements.t, doc.elements.f, "out")).toBe("fade");
  });

  it("cuts a clip in two at one second, and the second half carries on from where the first stopped", () => {
    let doc = runCommand(scene(), "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 100, height: 100, props: { src: "/a.mp4", start: 1, end: 9, clipFrom: 2 } });
    doc = runCommand(doc, "split_at", { sceneId: "f", t: 4, ids: ["v"], newIds: { v: "v2" } });
    expect([doc.elements.v.start, doc.elements.v.end, doc.elements.v.clipFrom]).toEqual([1, 4, 2]);
    expect([doc.elements.v2.start, doc.elements.v2.end, doc.elements.v2.clipFrom]).toEqual([4, 9, 5]);
    expect(doc.elements.f.childIds).toEqual(["r", "t", "v", "v2"]);
    // nothing to cut where nothing shows
    expect(runCommand(doc, "split_at", { sceneId: "f", t: 0.5, ids: ["v"] })).toBe(doc);
  });

  it("deletes a part and closes the gap it leaves", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 100, height: 100 });
    doc = runCommand(doc, "set_duration", { id: "f", seconds: 9 });
    for (const [id, start, end] of [["a", 0, 3], ["b", 3, 5], ["c", 5, 9]] as const) doc = runCommand(doc, "create_element", { type: "video", id, parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", start, end } });
    doc = runCommand(doc, "ripple_delete", { ids: ["b"] });
    expect(doc.elements.b).toBeUndefined();
    expect([doc.elements.a.start, doc.elements.a.end]).toEqual([0, 3]);
    expect([doc.elements.c.start, doc.elements.c.end]).toEqual([3, 7]);
    expect(doc.elements.f.duration).toBe(7);
  });

  it("a change by hand at another moment becomes a mark there, once a thing has been marked", () => {
    resetStore();
    loadDoc(scene());
    setClock({ scene: "f", t: 1 });
    // not marked yet: a move is a plain move
    dispatch("move_elements", { ids: ["r"], dx: 10, dy: 0 });
    expect(currentDoc().elements.r.x).toBe(110);
    expect(currentDoc().elements.r.keys).toEqual({});
    dispatch("key_now", { ids: ["r"], props: ["x", "y"], t: 1 });
    setClock({ t: 3 });
    dispatch("move_elements", { ids: ["r"], dx: 200, dy: 0 });
    const r = currentDoc().elements.r;
    expect(r.x).toBe(110);
    expect(r.keys.x?.map((k) => [k.t, k.v])).toEqual([[1, 110], [3, 310]]);
    // y did not change, so it has no new mark
    expect(r.keys.y?.length).toBe(1);
    expect(seenDoc().elements.r.x).toBe(310);
    expect(workDoc().elements.r.x).toBe(310);
    setClock({ t: 2 });
    expect(seenDoc().elements.r.x).toBe(210);
    // with the clock closed, the design is itself again
    setClock({ scene: null });
    expect(workDoc()).toBe(currentDoc());
    resetStore();
  });
});
