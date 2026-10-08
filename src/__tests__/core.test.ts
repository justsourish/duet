import { beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { descendants, frameAt, hitTest, snapRect, topLevelOnly, worldPos, worldRect } from "../document/geometry";
import { emptyDoc } from "../document/types";
import { defaultLayout, relayout } from "../document/layout";
import { distanceToLine, flatten, fromAbs, isSmooth, nearestOnLine, pathData, removeNode, splitSegment, toggleSmooth } from "../document/path";
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

describe("reparent_elements", () => {
  const base = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 100, y: 100, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "f2", type: "frame", x: 600, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "r1", type: "rect", x: 20, y: 20, width: 50, height: 50, parentId: "f1" });
    d = runCommand(d, "create_element", { id: "free", type: "rect", x: 650, y: 40, width: 50, height: 50 });
    return d;
  };

  it("moves a shape into a frame and keeps it where it looks", () => {
    const doc = runCommand(base(), "reparent_elements", { ids: ["free"], parentId: "f2" });
    expect(doc.elements.free.parentId).toBe("f2");
    expect(doc.elements.f2.childIds).toEqual(["free"]);
    expect(doc.rootIds).toEqual(["f1", "f2"]);
    expect(worldPos(doc, "free")).toEqual({ x: 650, y: 40 });
  });

  it("moves a shape out of a frame to the page", () => {
    const doc = runCommand(base(), "reparent_elements", { ids: ["r1"], parentId: null });
    expect(doc.elements.r1.parentId).toBeNull();
    expect(doc.elements.f1.childIds).toEqual([]);
    expect(doc.rootIds).toContain("r1");
    expect(worldPos(doc, "r1")).toEqual({ x: 120, y: 120 });
  });

  it("moves between frames", () => {
    const doc = runCommand(base(), "reparent_elements", { ids: ["r1"], parentId: "f2" });
    expect(doc.elements.f1.childIds).toEqual([]);
    expect(doc.elements.f2.childIds).toEqual(["r1"]);
    expect(worldPos(doc, "r1")).toEqual({ x: 120, y: 120 });
  });

  it("refuses to create something inside a shape that is not a frame", () => {
    const d = runCommand(emptyDoc(), "create_element", { id: "r", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(runCommand(d, "create_element", { id: "x", type: "rect", x: 0, y: 0, width: 5, height: 5, parentId: "r" })).toBe(d);
  });

  it("refuses to put a frame inside itself or its own child", () => {
    const d = base();
    expect(runCommand(d, "reparent_elements", { ids: ["f1"], parentId: "f1" })).toBe(d);
    const nested = runCommand(d, "reparent_elements", { ids: ["f2"], parentId: "f1" });
    expect(runCommand(nested, "reparent_elements", { ids: ["f1"], parentId: "f2" })).toBe(nested);
  });

  it("refuses a parent that is not a frame", () => {
    const d = base();
    expect(runCommand(d, "reparent_elements", { ids: ["free"], parentId: "r1" })).toBe(d);
  });

  it("reorders inside the same list", () => {
    let d = base();
    d = runCommand(d, "create_element", { id: "r2", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    d = runCommand(d, "create_element", { id: "r3", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    expect(d.elements.f1.childIds).toEqual(["r1", "r2", "r3"]);
    const front = runCommand(d, "reparent_elements", { ids: ["r1"], parentId: "f1" });
    expect(front.elements.f1.childIds).toEqual(["r2", "r3", "r1"]);
    const back = runCommand(d, "reparent_elements", { ids: ["r3"], parentId: "f1", index: 0 });
    expect(back.elements.f1.childIds).toEqual(["r3", "r1", "r2"]);
  });

  it("moves several at once, keeping their order", () => {
    let d = base();
    d = runCommand(d, "create_element", { id: "r2", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    const doc = runCommand(d, "reparent_elements", { ids: ["r1", "r2"], parentId: "f2" });
    expect(doc.elements.f2.childIds).toEqual(["r1", "r2"]);
    expect(doc.elements.f1.childIds).toEqual([]);
  });
});

import { describeSkill, toDuetSkill } from "../ai/skills";

describe("skill files", () => {
  it("reads the heading and summary of a Duet skill", () => {
    const d = describeSkill("# Spacing\nA steady rhythm.\n\n- Use 8 px.", "x");
    expect(d.name).toBe("Spacing");
    expect(d.summary).toBe("A steady rhythm.");
  });

  it("converts a skill with front matter into Duet's shape", () => {
    const text = "---\nname: diagnostic-sales-architect\ndescription: Find one leak. Then ask one question.\n---\n\n# Ignored title\n\nRule one.\nRule two.\n";
    const s = toDuetSkill(text, "fallback");
    expect(s.name).toBe("diagnostic-sales-architect");
    expect(s.body.startsWith("# diagnostic-sales-architect\nFind one leak.")).toBe(true);
    expect(s.body).toContain("Rule one.");
    expect(s.body).not.toContain("Ignored title");
  });

  it("falls back to the file name when there is no title", () => {
    expect(toDuetSkill("Just some rules.", "my-rules").name).toBe("my-rules");
  });
});

import { extractPayload, payloadToText, textToPayload } from "../document/clipboard";

describe("copy and paste", () => {
  const base = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 100, y: 100, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "f2", type: "frame", x: 600, y: 100, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 20, y: 20, width: 50, height: 50, parentId: "f1", props: { link: "f2", name: "Button" } });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 5, y: 5, width: 40, height: 20, parentId: "f1" });
    return d;
  };

  it("picks up an element with everything inside it", () => {
    const d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 200, height: 200 });
    const d2 = runCommand(d, "create_element", { id: "r", type: "rect", x: 1, y: 1, width: 10, height: 10, parentId: "f" });
    const p = extractPayload(d2, ["f", "r"])!;
    expect(p.rootIds).toEqual(["f"]);
    expect(Object.keys(p.elements).sort()).toEqual(["f", "r"]);
  });

  it("pastes new copies with new ids and keeps the structure", () => {
    const d = base();
    const p = extractPayload(d, ["f1"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: null, dx: 500, dy: 0, idMap: { f1: "new-f1", b: "new-b", t: "new-t" } });
    expect(out.rootIds).toEqual(["f1", "f2", "new-f1"]);
    expect(out.elements["new-f1"].childIds).toEqual(["new-b", "new-t"]);
    expect(out.elements["new-b"].parentId).toBe("new-f1");
    expect(out.elements["new-f1"].x).toBe(600);
    expect(Object.keys(out.elements).length).toBe(Object.keys(d.elements).length + 3);
  });

  it("does not change the original", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: "f2", dx: 0, dy: 0 });
    expect(out.elements.f1.childIds).toEqual(["b", "t"]);
    expect(out.elements.f2.childIds.length).toBe(1);
  });

  it("keeps a pasted piece where it looked, even inside another frame", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!; // sits at world 120,120
    const out = runCommand(d, "paste_elements", { payload: p, parentId: "f2", dx: 0, dy: 0, idMap: { b: "nb" } });
    expect(worldPos(out, "nb")).toEqual({ x: 120, y: 120 });
  });

  it("points a link at the copy when both were copied together", () => {
    const d = base();
    const p = extractPayload(d, ["f1", "f2"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: null, dx: 0, dy: 700, idMap: { f1: "n1", f2: "n2", b: "nb" } });
    expect(out.elements.nb.link).toBe("n2");
  });

  it("keeps a link to a screen that was not copied", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: "f1", dx: 16, dy: 16, idMap: { b: "nb" } });
    expect(out.elements.nb.link).toBe("f2");
  });

  it("refuses to paste into something that is not a frame", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    expect(runCommand(d, "paste_elements", { payload: p, parentId: "b" })).toBe(d);
  });

  it("travels as text and rejects anything else", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    expect(textToPayload(payloadToText(p))).toEqual(p);
    expect(textToPayload("hello")).toBeNull();
    expect(textToPayload('{"duet":2}')).toBeNull();
  });
});

import { toSvg } from "../document/svg";

describe("SVG export", () => {
  const sample = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "f", type: "frame", x: 50, y: 50, width: 200, height: 100, props: { fill: "#ffffff", radius: 12 } });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 10, y: 10, width: 80, height: 30, parentId: "f", props: { fill: "#e8743b", radius: 8, shadow: { x: 0, y: 4, blur: 12, color: "#00000040" } } });
    d = runCommand(d, "create_element", { id: "g", type: "ellipse", x: 120, y: 10, width: 40, height: 40, parentId: "f", props: { gradient: { from: "#ff0000", to: "#0000ff", angle: 90 } } });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 10, y: 60, width: 100, height: 20, parentId: "f", props: { text: "Tom & <Jerry>", fontSize: 14 } });
    return d;
  };

  it("draws the element at the corner of its own picture", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain('width="200" height="100" viewBox="0 0 200 100"');
    expect(svg).toContain('<rect x="0" y="0" width="200" height="100" rx="12"');
  });

  it("puts children inside, clipped to the frame", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain("<clipPath");
    expect(svg).toContain('<rect x="10" y="10" width="80" height="30" rx="8"');
  });

  it("includes gradients and shadows", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain("feDropShadow");
    expect(svg).toContain('flood-opacity="0.251"');
  });

  it("escapes text", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain("Tom &amp; &lt;Jerry&gt;");
    expect(svg).not.toContain("<Jerry>");
  });

  it("is well formed", () => {
    const svg = toSvg(sample(), "f");
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
  });
});

import { linkAt, startFrame } from "../ui/PresentView";

describe("present mode", () => {
  const flow = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "home", type: "frame", x: 0, y: 0, width: 300, height: 600 });
    d = runCommand(d, "create_element", { id: "order", type: "frame", x: 400, y: 0, width: 300, height: 600 });
    d = runCommand(d, "create_element", { id: "btn", type: "rect", x: 20, y: 500, width: 260, height: 50, parentId: "home", props: { link: "order" } });
    d = runCommand(d, "create_element", { id: "label", type: "text", x: 10, y: 10, width: 60, height: 20, parentId: "btn" as never });
    return d;
  };

  it("follows a link when the linked thing is clicked", () => {
    expect(linkAt(flow(), "home", 100, 520)).toBe("order");
  });

  it("ignores clicks on things with no link", () => {
    expect(linkAt(flow(), "home", 100, 100)).toBeNull();
  });

  it("uses the link of something that holds what was clicked", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "a", type: "frame", x: 0, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "b", type: "frame", x: 400, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "card", type: "frame", x: 10, y: 10, width: 200, height: 100, parentId: "a", props: { link: "b" } });
    d = runCommand(d, "create_element", { id: "inner", type: "text", x: 5, y: 5, width: 50, height: 20, parentId: "card" });
    expect(linkAt(d, "a", 20, 20)).toBe("b");
  });

  it("starts on the selected screen, or the screen holding the selection", () => {
    const d = flow();
    expect(startFrame(d, ["order"])).toBe("order");
    expect(startFrame(d, ["btn"])).toBe("home");
    expect(startFrame(d, [])).toBe("home");
  });

  it("ignores a link to something that is not a screen", () => {
    let d = flow();
    d = runCommand(d, "set_props", { ids: ["btn"], props: { link: "label" } });
    expect(linkAt(d, "home", 100, 520)).toBeNull();
  });
});

describe("images", () => {
  const withImage = () =>
    runCommand(frame(), "create_element", {
      id: "pic",
      type: "image",
      parentId: "f1",
      x: 10,
      y: 10,
      width: 120,
      height: 80,
      props: { src: "assets/abc123.png", name: "Photo" },
    });

  it("keeps the picture's place in the project through save and open", () => {
    const back = parseDoc(serializeDoc(withImage()));
    expect(back.elements.pic.type).toBe("image");
    expect(back.elements.pic.src).toBe("assets/abc123.png");
  });

  it("leaves old designs without a picture field, so their files do not change", () => {
    expect(serializeDoc(frame())).not.toContain('"src"');
  });

  it("opens files that have no src at all", () => {
    const text = serializeDoc(frame());
    expect(parseDoc(text).elements.f1.src).toBe("");
  });

  it("writes a picture into the SVG export, clipped to its box", () => {
    const svg = toSvg(withImage(), "f1");
    expect(svg).toContain("<clipPath");
  });
});

describe("drawn lines", () => {
  const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });

  it("fits a box around the points and keeps them as fractions of it", () => {
    const shape = fromAbs([corner(100, 50), corner(300, 50), corner(300, 250)]);
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([100, 50, 200, 200]);
    expect(shape.nodes[1]).toMatchObject({ x: 1, y: 0 });
    expect(shape.nodes[2]).toMatchObject({ x: 1, y: 1 });
  });

  it("includes curve handles in the box", () => {
    const shape = fromAbs([{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 100 }, corner(100, 0)]);
    expect(shape.height).toBe(100);
  });

  it("writes straight pieces as L and curved pieces as C", () => {
    expect(pathData([corner(0, 0), corner(10, 0)], false)).toBe("M0 0L10 0");
    const curved = pathData([{ x: 0, y: 0, ix: 0, iy: 0, ox: 5, oy: 5 }, corner(10, 0)], false);
    expect(curved).toContain("C5 5");
  });

  it("closes a shape with Z", () => {
    expect(pathData([corner(0, 0), corner(10, 0), corner(10, 10)], true).endsWith("Z")).toBe(true);
  });

  it("finds a thin line under the pointer and ignores empty space next to it", () => {
    const shape = fromAbs([corner(0, 0), corner(200, 0)]);
    let d = runCommand(frame("f"), "create_element", {
      id: "ln",
      type: "path",
      parentId: "f",
      x: shape.x,
      y: 100,
      width: shape.width,
      height: shape.height,
      props: { nodes: shape.nodes, closed: false },
    });
    // frame f sits at 100,50 so the line is at 100,150 on the page
    expect(hitTest(d, 200, 152)).toBe("ln");
    expect(hitTest(d, 200, 200)).toBe("f");
    d = runCommand(d, "set_props", { ids: ["ln"], props: { closed: true } });
    expect(hitTest(d, 200, 150.5)).toBe("ln");
  });

  it("saves and reopens a drawn line", () => {
    const shape = fromAbs([corner(0, 0), corner(50, 80)]);
    const d = runCommand(emptyDoc(), "create_element", {
      id: "ln",
      type: "path",
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      props: { nodes: shape.nodes, closed: false },
    });
    expect(parseDoc(serializeDoc(d)).elements.ln.nodes).toEqual(shape.nodes);
  });
});

describe("editing the points of a line", () => {
  const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });

  it("adds a point in the middle of a straight piece", () => {
    const r = splitSegment([corner(0, 0), corner(100, 0)], false, 0, 0.5);
    expect(r.nodes).toHaveLength(3);
    expect(r.nodes[1]).toMatchObject({ x: 50, y: 0 });
    expect(r.index).toBe(1);
  });

  it("splits a curve without changing its shape", () => {
    const a = { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 60 };
    const b = { x: 100, y: 0, ix: 0, iy: 60, ox: 0, oy: 0 };
    const before = flatten([a, b], false, 40);
    const r = splitSegment([a, b], false, 0, 0.5);
    const after = flatten(r.nodes, false, 20);
    const worst = Math.max(...after.map((p) => distanceToLine(p.x, p.y, before)));
    expect(worst).toBeLessThan(0.6);
  });

  it("adds a point on the closing piece at the end", () => {
    const r = splitSegment([corner(0, 0), corner(100, 0), corner(100, 100)], true, 2, 0.5);
    expect(r.index).toBe(3);
    expect(r.nodes[3]).toMatchObject({ x: 50, y: 50 });
  });

  it("finds the closest piece of the line", () => {
    const hit = nearestOnLine([corner(0, 0), corner(100, 0), corner(100, 100)], false, 100, 60);
    expect(hit.segment).toBe(1);
    expect(hit.distance).toBeLessThan(1);
  });

  it("turns a corner into a smooth join and back", () => {
    const nodes = [corner(0, 0), corner(50, 0), corner(100, 50)];
    const smooth = toggleSmooth(nodes, false, 1);
    expect(isSmooth(smooth[1])).toBe(true);
    const back = toggleSmooth(smooth, false, 1);
    expect(isSmooth(back[1])).toBe(false);
    expect(back[1].ox).toBe(0);
  });

  it("will not remove points below the minimum", () => {
    expect(removeNode([corner(0, 0), corner(1, 1)], false, 0)).toHaveLength(2);
    expect(removeNode([corner(0, 0), corner(1, 1), corner(2, 0)], true, 0)).toHaveLength(3);
    expect(removeNode([corner(0, 0), corner(1, 1), corner(2, 0)], false, 1)).toHaveLength(2);
  });
});

describe("auto layout", () => {
  const stack = (layout: Partial<NonNullable<import("../document/types").El["layout"]>> = {}) => {
    let d = frame("box"); // 300 by 400 at 100,50
    for (const [id, w, h] of [["a", 100, 40], ["b", 80, 60], ["c", 120, 20]] as const) {
      d = runCommand(d, "create_element", { id, type: "rect", parentId: "box", x: 0, y: 0, width: w, height: h });
    }
    return runCommand(d, "set_props", { ids: ["box"], props: { layout: { ...defaultLayout(), ...layout } } });
  };
  const at = (d: ReturnType<typeof stack>, id: string) => [d.elements[id].x, d.elements[id].y];

  it("stacks children in a column with a gap and padding", () => {
    const d = stack({ dir: "column", gap: 10, padX: 20, padY: 30 });
    expect(at(d, "a")).toEqual([20, 30]);
    expect(at(d, "b")).toEqual([20, 80]);
    expect(at(d, "c")).toEqual([20, 150]);
  });

  it("lines children up in a row", () => {
    const d = stack({ dir: "row", gap: 8, padX: 10, padY: 10 });
    expect(at(d, "a")).toEqual([10, 10]);
    expect(at(d, "b")).toEqual([118, 10]);
    expect(at(d, "c")).toEqual([206, 10]);
  });

  it("centres children across the direction", () => {
    const d = stack({ dir: "column", align: "center", padX: 0, padY: 0, gap: 0 });
    expect(d.elements.a.x).toBe(100); // (300 - 100) / 2
    expect(d.elements.b.x).toBe(110);
  });

  it("spreads children with equal space between", () => {
    const d = stack({ dir: "column", justify: "between", padX: 0, padY: 0, gap: 0 });
    expect(d.elements.a.y).toBe(0);
    expect(d.elements.c.y).toBe(380); // 400 - 20
    expect(d.elements.b.y).toBe(180); // equal gaps of 140: 40 + 140
  });

  it("hugs its content", () => {
    const d = stack({ dir: "column", gap: 10, padX: 20, padY: 30, hug: true });
    expect(d.elements.box.height).toBe(30 + 40 + 10 + 60 + 10 + 20 + 30);
    expect(d.elements.box.width).toBe(20 + 120 + 20);
  });

  it("stretches children across the frame", () => {
    const d = stack({ dir: "column", align: "stretch", padX: 10, padY: 0, gap: 0 });
    expect(d.elements.a.width).toBe(280);
    expect(d.elements.c.width).toBe(280);
  });

  it("lets a child grow to fill the free space", () => {
    let d = stack({ dir: "column", gap: 0, padX: 0, padY: 0 });
    d = runCommand(d, "set_props", { ids: ["b"], props: { grow: 1 } });
    expect(d.elements.b.height).toBe(400 - 40 - 20);
    expect(d.elements.c.y).toBe(380);
  });

  it("reorders when a child is moved past another", () => {
    let d = stack({ dir: "column", gap: 0, padX: 0, padY: 0 });
    d = runCommand(d, "move_elements", { ids: ["a"], dx: 0, dy: 200 });
    expect(d.elements.box.childIds).toEqual(["b", "c", "a"]);
  });

  it("changes nothing when no frame uses it", () => {
    const d = frame("plain");
    expect(relayout(d)).toBe(d);
  });

  it("saves and reopens a layout, and leaves other files unchanged", () => {
    const d = stack({ dir: "row" });
    expect(parseDoc(serializeDoc(d)).elements.box.layout?.dir).toBe("row");
    expect(serializeDoc(frame())).not.toContain('"layout"');
  });
});

describe("wrapping in auto layout", () => {
  it("puts selected siblings in a new frame that hugs them", () => {
    let d = frame("box");
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "box", x: 20, y: 30, width: 50, height: 50 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", parentId: "box", x: 120, y: 40, width: 60, height: 40 });
    d = runCommand(d, "wrap_in_layout", { ids: ["a", "b"], frameId: "wrap" });
    expect(d.elements.a.parentId).toBe("wrap");
    expect(d.elements.box.childIds).toEqual(["wrap"]);
    expect(d.elements.wrap.layout?.hug).toBe(true);
    expect(d.elements.wrap.layout?.dir).toBe("row");
    // 50 + 12 + 60 wide, as tall as the tallest
    expect([d.elements.wrap.width, d.elements.wrap.height]).toEqual([122, 50]);
    expect([d.elements.wrap.x, d.elements.wrap.y]).toEqual([20, 30]);
  });

  it("will not wrap things that live in different frames", () => {
    let d = runCommand(frame("one"), "create_element", { id: "two", type: "frame", x: 500, y: 0, width: 100, height: 100 });
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "one", x: 0, y: 0, width: 10, height: 10 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", parentId: "two", x: 0, y: 0, width: 10, height: 10 });
    const same = runCommand(d, "wrap_in_layout", { ids: ["a", "b"], frameId: "wrap" });
    expect(same.elements.wrap).toBeUndefined();
  });
});

describe("groups and locking", () => {
  const scene = () => {
    let d = frame("box"); // 300 by 400 at 100,50
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "box", x: 20, y: 30, width: 50, height: 50 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", parentId: "box", x: 120, y: 40, width: 60, height: 40 });
    return d;
  };

  it("groups siblings into one thing that is exactly as big as they are", () => {
    const d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    expect(d.elements.box.childIds).toEqual(["g"]);
    expect(d.elements.g.type).toBe("group");
    expect([d.elements.g.x, d.elements.g.y, d.elements.g.width, d.elements.g.height]).toEqual([20, 30, 160, 50]);
    expect([d.elements.a.x, d.elements.a.y]).toEqual([0, 0]);
    expect([d.elements.b.x, d.elements.b.y]).toEqual([100, 10]);
  });

  it("keeps the same picture on the page after grouping and ungrouping", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "ungroup", { ids: ["g"] });
    expect(d.elements.g).toBeUndefined();
    expect(d.elements.box.childIds).toEqual(["a", "b"]);
    expect([d.elements.a.x, d.elements.a.y]).toEqual([20, 30]);
    expect([d.elements.b.x, d.elements.b.y]).toEqual([120, 40]);
  });

  it("moves everything inside when the group moves, and refits when a child moves", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "move_elements", { ids: ["g"], dx: 10, dy: 0 });
    expect(worldRect(d, "a").x).toBe(100 + 30);
    d = runCommand(d, "move_elements", { ids: ["b"], dx: 50, dy: 0 });
    expect(d.elements.g.width).toBe(210);
  });

  it("scales what is inside when the group is resized", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "resize_element", { id: "g", x: 20, y: 30, width: 320, height: 100 });
    expect([d.elements.a.width, d.elements.a.height]).toEqual([100, 100]);
    expect(d.elements.b.x).toBe(200);
    expect(d.elements.g.width).toBe(320);
  });

  it("picks the whole group when you click inside it, and a single child when you dig in", () => {
    const d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    // a sits at 120,80 on the page (box 100,50 + 20,30)
    expect(hitTest(d, 130, 90)).toBe("g");
    expect(hitTest(d, 130, 90, new Set(), true)).toBe("a");
  });

  it("clicks go through a locked frame to what is inside it, and to what is behind it", () => {
    let d = scene();
    d = runCommand(d, "set_props", { ids: ["box"], props: { locked: true } });
    expect(hitTest(d, 130, 90)).toBe("a"); // the picture inside is still pickable
    expect(hitTest(d, 380, 400)).toBeNull(); // empty frame area: nothing to pick
  });

  it("will not group things that live in different frames", () => {
    let d = runCommand(scene(), "create_element", { id: "two", type: "frame", x: 600, y: 0, width: 100, height: 100 });
    d = runCommand(d, "create_element", { id: "c", type: "rect", parentId: "two", x: 0, y: 0, width: 10, height: 10 });
    const same = runCommand(d, "group_elements", { ids: ["a", "c"], groupId: "g" });
    expect(same.elements.g).toBeUndefined();
  });

  it("saves groups and locks, and leaves other files unchanged", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "set_props", { ids: ["a"], props: { locked: true } });
    const back = parseDoc(serializeDoc(d));
    expect(back.elements.g.type).toBe("group");
    expect(back.elements.a.locked).toBe(true);
    expect(serializeDoc(frame())).not.toContain('"locked"');
  });

  it("draws a group into the SVG export", () => {
    const d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    expect(toSvg(d, "box")).toContain("<g>");
  });
});
