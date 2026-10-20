import { describe, expect, it } from "vitest";
import { NAMES, giveNames, nameOf, nextName, readGiven } from "./names";

describe("AI names", () => {
  it("has fifteen names", () => {
    expect(NAMES).toHaveLength(15);
    expect(new Set(NAMES).size).toBe(15);
  });

  it("gives each tool the next free name, once", () => {
    const a = giveNames(["Claude Code", "Antigravity"], {});
    expect(a).toEqual({ "Claude Code": "Juniper", Antigravity: "Moss" });
    expect(giveNames(["Claude Code"], a)).toBe(a);
  });

  it("knows a tool working from its own window by the same name", () => {
    const a = giveNames(["Cursor (outside)"], {});
    expect(nameOf("Cursor (outside)", a)).toBe("Juniper");
  });

  it("skips a name the designer gave by hand", () => {
    expect(nextName({ "Claude Code": "juniper" })).toBe("Moss");
  });

  it("starts the list again with a number after fifteen", () => {
    const all = Object.fromEntries(NAMES.map((n, i) => [`Tool ${i}`, n]));
    expect(nextName(all)).toBe("Juniper 2");
  });

  it("shows the tool's own name when it has none", () => {
    expect(nameOf("Codex", {})).toBe("Codex");
  });

  it("keeps only plain names from a file", () => {
    expect(readGiven({ "Claude Code": " Juniper ", x: 3, y: "" })).toEqual({ "Claude Code": "Juniper" });
    expect(readGiven(null)).toEqual({});
  });
});
