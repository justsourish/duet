import { beforeEach, describe, expect, it } from "vitest";
import { emptyDoc } from "../document/types";
import { runCommand } from "../commands";
import { dispatch, getState, loadDoc, setFocus } from "./store";

describe("AI focus", () => {
  beforeEach(() => {
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [
        { id: "a", type: "frame", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", type: "frame", x: 200, y: 0, width: 100, height: 100 },
      ],
    });
    loadDoc(doc, "test");
  });

  it("starts empty and holds what it is pointed at", () => {
    expect(getState().focus).toEqual([]);
    setFocus(["a"]);
    expect(getState().focus).toEqual(["a"]);
  });

  it("drops a thing from the focus when that thing is deleted", () => {
    setFocus(["a", "b"]);
    dispatch("delete_elements", { ids: ["a"] });
    expect(getState().focus).toEqual(["b"]);
  });

  it("is cleared when another design is opened", () => {
    setFocus(["a"]);
    loadDoc(emptyDoc(), "other");
    expect(getState().focus).toEqual([]);
  });
});
