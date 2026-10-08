import { beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { descendants, frameAt, hitTest, snapRect, topLevelOnly, worldPos, worldRect } from "../document/geometry";
import { emptyDoc } from "../document/types";
import { resizeRect } from "../canvas/handles";
import {
  currentDoc,
  dispatch,
  dragBase,
  dragCommit,
  dragPreview,
  getState,
  goTo,
  redo,
  resetStore,
  undo,
} from "../state/store";

const frame = (id = "f1") =>
  runCommand(emptyDoc(), "create_element", { id, type: "frame", x: 100, y: 50, width: 300, height: 400 });

describe("commands", () => {
  it("creates a root element", () => {
    const doc = frame();
    expect(doc.rootIds).toEqual(["f1"]);
    expect(doc.elements.f1.name).toBe("Frame 1");
  });

  it("does not mutate the old document", () => {
    const a = frame();
    const b = runCommand(a, "move_elements", { ids: ["f1"], dx: 10, dy: 0 });
    expect(a.elements.f1.x).toBe(100);
    expect(b.elements.f1.x).toBe(110);
  });

  it("nests children with positions relative to the frame", () => {
    let doc = frame();
    doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 20, y: 30, width: 50, height: 50, parentId: "f1" });
    expect(doc.elements.f1.childIds).toEqual(["r1"]);
    expect(worldPos(doc, "r1")).toEqual({ x: 120, y: 80 });
    doc = runCommand(doc, "move_elements", { ids: ["f1"], dx: 10, dy: 10 });
    expect(worldPos(doc, "r1")).toEqual({ x: 130, y: 90 });
  });

  it("deletes a frame together with its children", () => {
    let doc = frame();
    doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    doc = runCommand(doc, "delete_elements", { ids: ["f1"] });
    expect(doc.rootIds).toEqual([]);
    expect(Object.keys(doc.elements)).toEqual([]);
  });

  it("removes a child from its parent when deleted", () => {
    let doc = frame();
    doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    doc = runCommand(doc, "delete_elements", { ids: ["r1"] });
    expect(doc.elements.f1.childIds).toEqual([]);
  });

  it("resizes with a minimum of 1", () => {
    const doc = runCommand(frame(), "resize_element", { id: "f1", x: 0, y: 0, width: -5, height: 0 });
    expect(doc.elements.f1.width).toBe(1);
    expect(doc.elements.f1.height).toBe(1);
  });

  it("sets properties on several elements", () => {
    let doc = frame("a");
    doc = runCommand(doc, "create_element", { id: "b", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_props", { ids: ["a", "b"], props: { fill: "#ff0000" } });
    expect(doc.elements.a.fill).toBe("#ff0000");
    expect(doc.elements.b.fill).toBe("#ff0000");
  });

  it("serialises to plain JSON and back", () => {
    const doc = frame();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("geometry", () => {
  const doc = (() => {
    let d = frame();
    d = runCommand(d, "create_element", { id: "r1", type: "rect", x: 10, y: 10, width: 100, height: 100, parentId: "f1" });
    d = runCommand(d, "create_element", { id: "e1", type: "ellipse", x: 500, y: 500, width: 100, height: 100 });
    return d;
  })();

  it("hits the deepest element", () => {
    expect(hitTest(doc, 150, 100)).toBe("r1");
    expect(hitTest(doc, 350, 400)).toBe("f1");
    expect(hitTest(doc, 0, 0)).toBeNull();
  });

  it("respects the round shape of an ellipse", () => {
    expect(hitTest(doc, 550, 550)).toBe("e1");
    expect(hitTest(doc, 502, 502)).toBeNull();
  });

  it("finds the frame under a point", () => {
    expect(frameAt(doc, 150, 100)).toBe("f1");
    expect(frameAt(doc, 550, 550)).toBeNull();
  });

  it("lists descendants", () => {
    expect(descendants(doc, "f1")).toEqual(["r1"]);
  });

  it("drops children whose parent is also selected", () => {
    expect(topLevelOnly(doc, ["f1", "r1", "e1"])).toEqual(["f1", "e1"]);
  });

  it("computes world rectangles", () => {
    expect(worldRect(doc, "r1")).toEqual({ x: 110, y: 60, width: 100, height: 100 });
  });

  it("snaps edges that are close and ignores far ones", () => {
    const near = snapRect({ x: 103, y: 0, width: 50, height: 50 }, [{ x: 100, y: 500, width: 10, height: 10 }], 6);
    expect(near.dx).toBe(2); // nearest edge is the other box's centre at 105
    expect(near.guidesX).toEqual([105]);
    const far = snapRect({ x: 130, y: 0, width: 50, height: 50 }, [{ x: 100, y: 500, width: 10, height: 10 }], 6);
    expect(far.dx).toBe(0);
    expect(far.guidesX).toEqual([]);
  });

  it("snaps centres", () => {
    const r = snapRect({ x: 41, y: 0, width: 20, height: 20 }, [{ x: 0, y: 500, width: 100, height: 10 }], 6);
    expect(r.dx).toBe(-1);
    expect(r.guidesX).toEqual([50]);
  });
});

describe("resize handles", () => {
  const r = { x: 100, y: 100, width: 100, height: 50 };
  it("drags the south-east corner", () => {
    expect(resizeRect(r, "se", 20, 10)).toEqual({ x: 100, y: 100, width: 120, height: 60 });
  });
  it("drags the north-west corner", () => {
    expect(resizeRect(r, "nw", 10, 10)).toEqual({ x: 110, y: 110, width: 90, height: 40 });
  });
  it("flips past the opposite edge", () => {
    expect(resizeRect(r, "e", -150, 0)).toEqual({ x: 50, y: 100, width: 50, height: 50 });
  });
});

describe("store and history", () => {
  beforeEach(() => resetStore());

  it("records each command as one history step", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("move_elements", { ids: ["a"], dx: 5, dy: 5 });
    expect(getState().timeline.map((t) => t.label)).toEqual(["New file", "Add rectangle", "Move element"]);
  });

  it("undoes, redoes and jumps", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("move_elements", { ids: ["a"], dx: 5, dy: 5 });
    undo();
    expect(currentDoc().elements.a.x).toBe(0);
    redo();
    expect(currentDoc().elements.a.x).toBe(5);
    goTo(0);
    expect(currentDoc().rootIds).toEqual([]);
  });

  it("drops the redo branch when you change something after undo", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("move_elements", { ids: ["a"], dx: 5, dy: 5 });
    undo();
    dispatch("move_elements", { ids: ["a"], dx: 1, dy: 1 });
    expect(getState().timeline.length).toBe(3);
    expect(currentDoc().elements.a.x).toBe(1);
  });

  it("a whole drag is a single history step", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    const before = getState().timeline.length;
    for (let i = 1; i <= 30; i++) dragPreview("move_elements", { ids: ["a"], dx: i, dy: 0 });
    expect(getState().timeline.length).toBe(before);
    expect(currentDoc().elements.a.x).toBe(30);
    expect(dragBase().elements.a.x).toBe(0);
    dragCommit("Move element");
    expect(getState().timeline.length).toBe(before + 1);
    expect(currentDoc().elements.a.x).toBe(30);
  });

  it("tags who made each change", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 }, "ai");
    expect(getState().timeline[1].actor).toBe("ai");
  });

  it("clears a selection that no longer exists after undo", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    undo();
    expect(getState().selection).toEqual([]);
  });
});

import { DesignFileError, parseDoc, serializeDoc } from "../document/serialize";

describe("design file", () => {
  const sample = () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "z-frame", type: "frame", x: 0, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "a-rect", type: "rect", x: 5, y: 5, width: 50, height: 50, parentId: "z-frame" });
    return d;
  };

  it("round-trips exactly", () => {
    const doc = sample();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("writes elements sorted by id, so diffs stay small", () => {
    const keys = Object.keys(JSON.parse(serializeDoc(sample())).elements);
    expect(keys).toEqual(["a-rect", "z-frame"]);
  });

  it("gives the same text for the same design", () => {
    expect(serializeDoc(sample())).toBe(serializeDoc(sample()));
  });

  it("fills in missing properties from older files", () => {
    const text = JSON.stringify({ version: 1, rootIds: ["a"], elements: { a: { type: "rect", x: 1, y: 2 } } });
    const doc = parseDoc(text);
    expect(doc.elements.a.width).toBe(100);
    expect(doc.elements.a.childIds).toEqual([]);
  });

  it("rejects things that are not design files", () => {
    expect(() => parseDoc("hello")).toThrow(DesignFileError);
    expect(() => parseDoc("{}")).toThrow(DesignFileError);
    expect(() => parseDoc(JSON.stringify({ version: 1, rootIds: ["x"], elements: {} }))).toThrow(DesignFileError);
    expect(() => parseDoc(JSON.stringify({ version: 1, rootIds: [], elements: { a: { type: "star" } } }))).toThrow(DesignFileError);
  });
});
