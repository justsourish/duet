import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { idsToUnfoldForSelection, toggleFold } from "./LayersPanel";

function sampleDoc() {
  let doc = emptyDoc();
  // f1 holds g1 and r1
  doc = runCommand(doc, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 300, height: 300 });
  doc = runCommand(doc, "create_element", { id: "r_inner", type: "rect", parentId: "f1", x: 10, y: 10, width: 20, height: 20 });
  doc = runCommand(doc, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 50, y: 50, width: 40, height: 40 });
  doc = runCommand(doc, "group_elements", { ids: ["r_inner"], groupId: "g1" });
  // f2 is another root frame holding r2
  doc = runCommand(doc, "create_element", { id: "f2", type: "frame", x: 400, y: 0, width: 200, height: 200 });
  doc = runCommand(doc, "create_element", { id: "r2", type: "rect", parentId: "f2", x: 10, y: 10, width: 20, height: 20 });
  // root_rect is a plain shape on the page
  doc = runCommand(doc, "create_element", { id: "root_rect", type: "rect", x: 700, y: 0, width: 50, height: 50 });
  return doc;
}

describe("fold layers in the layers panel", () => {
  describe("which ids to unfold for a selection", () => {
    it("returns nothing when nothing is selected", () => {
      const doc = sampleDoc();
      expect(idsToUnfoldForSelection(doc, [])).toEqual(new Set());
    });

    it("returns nothing when only root elements are selected", () => {
      const doc = sampleDoc();
      expect(idsToUnfoldForSelection(doc, ["root_rect"])).toEqual(new Set());
      expect(idsToUnfoldForSelection(doc, ["f1", "f2"])).toEqual(new Set());
    });

    it("unfolds the parent frame when something inside it is selected", () => {
      const doc = sampleDoc();
      expect(idsToUnfoldForSelection(doc, ["r1"])).toEqual(new Set(["f1"]));
    });

    it("unfolds every parent above deeply nested elements", () => {
      const doc = sampleDoc();
      expect(idsToUnfoldForSelection(doc, ["r_inner"])).toEqual(new Set(["g1", "f1"]));
    });

    it("unfolds parents for multiple selected elements across frames", () => {
      const doc = sampleDoc();
      expect(idsToUnfoldForSelection(doc, ["r_inner", "r2"])).toEqual(new Set(["g1", "f1", "f2"]));
    });

    it("filters to only ids that are currently folded when a folded set is given", () => {
      const doc = sampleDoc();
      const folded = new Set(["f1", "f2"]); // g1 is not folded
      expect(idsToUnfoldForSelection(doc, ["r_inner"], folded)).toEqual(new Set(["f1"]));
    });

    it("ignores missing ids cleanly", () => {
      const doc = sampleDoc();
      expect(idsToUnfoldForSelection(doc, ["nonexistent"])).toEqual(new Set());
    });
  });

  describe("toggling fold on an element", () => {
    it("folds an open element and unfolds a folded element", () => {
      const doc = sampleDoc();
      const foldedOnce = toggleFold(new Set(), "f1", false, doc);
      expect(foldedOnce).toEqual(new Set(["f1"]));

      const unfolded = toggleFold(foldedOnce, "f1", false, doc);
      expect(unfolded).toEqual(new Set());
    });

    it("option click folds an element and everything inside it with children", () => {
      const doc = sampleDoc();
      // f1 contains g1 (group with children) and r1, r_inner (leaf shapes)
      const folded = toggleFold(new Set(), "f1", true, doc);
      expect(folded).toEqual(new Set(["f1", "g1"]));
    });

    it("option click unfolds an element and everything inside it", () => {
      const doc = sampleDoc();
      const allFolded = new Set(["f1", "g1"]);
      const unfolded = toggleFold(allFolded, "f1", true, doc);
      expect(unfolded).toEqual(new Set());
    });

    it("option click when only the outer frame is folded still clears all nested folds", () => {
      const doc = sampleDoc();
      const folded = new Set(["f1", "other_unrelated"]);
      const next = toggleFold(folded, "f1", true, doc);
      expect(next).toEqual(new Set(["other_unrelated"]));
    });
  });
});
