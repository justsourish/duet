import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";
import { currentDoc, loadDoc, resetStore, setClock, select } from "../state/store";
import { wireKeys } from "./keys";

let press: (e: object) => void = () => {};
(globalThis as any).window = { addEventListener: (_: string, f: (e: object) => void) => (press = f) };

describe("Option T", () => {
  it("marks opacity only on the selected layer", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
    for (const id of ["a", "b", "c"]) doc = runCommand(doc, "create_element", { type: "rect", id, parentId: "f", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_duration", { id: "f", seconds: 10 });
    resetStore();
    loadDoc(doc);
    setClock({ scene: "f", t: 5 });
    select(["b"]);
    wireKeys();
    press({ code: "KeyT", altKey: true, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} });
    const els = currentDoc().elements;
    expect(Object.keys(els.b.keys)).toEqual(["opacity"]);
    expect(els.a.keys).toEqual({});
    expect(els.c.keys).toEqual({});
  });

  it("marks only the selected layer in a design that was saved and opened again", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
    for (const id of ["a", "b", "c"]) doc = runCommand(doc, "create_element", { type: "rect", id, parentId: "f", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_duration", { id: "f", seconds: 10 });
    resetStore();
    loadDoc(parseDoc(serializeDoc(doc)));
    setClock({ scene: "f", t: 5 });
    select(["b"]);
    wireKeys();
    press({ code: "KeyT", altKey: true, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} });
    const els = currentDoc().elements;
    expect(Object.keys(els.b.keys)).toEqual(["opacity"]);
    expect(els.a.keys).toEqual({});
    expect(els.c.keys).toEqual({});
    expect(els.f.keys).toEqual({});
  });
});
