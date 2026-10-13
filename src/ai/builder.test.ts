import { describe, expect, it } from "vitest";
import { BUILDER_TOOLS, isBuilderTool, lineText, pick, sampleDoc } from "./builder";
import { TOOLS } from "./tools";

const lines = [
  { kind: "button", name: "New" },
  { kind: "row", name: "Frame 1" },
  { kind: "thing", name: "Fold" },
  { kind: "row", name: "Group 1" },
  { kind: "thing", name: "Fold" },
  { kind: "text", name: "New here? Draw a frame." },
];

describe("builder tools", () => {
  it("picks the one thing with that exact name, whatever the capitals", () => {
    expect(pick(lines, "new")).toBe(0);
    expect(pick(lines, "Frame 1")).toBe(1);
  });

  it("falls back to a name that holds the words", () => {
    expect(pick(lines, "Group")).toBe(3);
  });

  it("never picks plain text", () => {
    expect(pick(lines, "Draw a frame")).toMatch(/Nothing on the screen/);
  });

  it("asks which one when several share a name, and takes nth", () => {
    expect(pick(lines, "Fold")).toMatch(/2 things.*lines 3, 5/);
    expect(pick(lines, "Fold", 2)).toBe(4);
    expect(pick(lines, "Fold", 3)).toMatch(/only 2/);
  });

  it("says so when no name is given", () => {
    expect(pick(lines, " ")).toMatch(/give n or name/);
  });

  it("writes a line with its number, marks and depth", () => {
    expect(lineText(4, { kind: "thing", name: "Fold", marks: ["fold-arrow", "folded"], depth: 1 })).toBe('  4 thing "Fold" [fold-arrow, folded]');
    expect(lineText(1, { kind: "button", name: "New", marks: [], depth: 0 })).toBe('1 button "New"');
  });

  it("starts a sample with a frame that holds a shape and a group, and a plain shape", () => {
    const doc = sampleDoc();
    expect(doc.rootIds).toEqual(["test-frame", "test-plain"]);
    expect(doc.elements["test-frame"].childIds).toContain("test-inner");
    expect(doc.elements["test-frame"].childIds).toContain("test-group");
    expect(doc.elements["test-group"].childIds).toEqual(["test-grouped"]);
  });

  it("keeps its names apart from the design tools", () => {
    for (const t of BUILDER_TOOLS) {
      expect(t.name.startsWith("dev_")).toBe(true);
      expect(TOOLS.some((d) => d.name === t.name)).toBe(false);
    }
    expect(isBuilderTool("dev_press")).toBe(true);
    expect(isBuilderTool("delete_elements")).toBe(false);
  });
});
