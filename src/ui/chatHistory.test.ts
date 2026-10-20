import { describe, expect, it } from "vitest";
import type { Msg } from "../ai/chat";
import { chatHistory, findInHistory } from "./chatHistory";
import type { Moment } from "./chatHistory";

const step = (label: string, time: number, more: Partial<Moment> = {}): Moment => ({ label, actor: "you", time, step: `s-${label}`, ...more });

describe("the chat is the history", () => {
  const timeline: Moment[] = [
    step("New file", 0),
    step("Draw box", 10),
    step("Colour box", 20, { actor: "ai", by: "Claude Code" }),
    step("Move box", 30, { actor: "ai", by: "Claude Code", version: "Logo v1" }),
    step("Nudge", 50),
    step("Spacing", 60, { actor: "ai", by: "Cursor (outside)" }),
  ];
  const messages: Msg[] = [
    { id: 1, role: "you", text: "Colour the box", time: 15 },
    { id: 2, role: "duet", text: "Done.", time: 31, by: "Claude Code" },
    { id: 3, role: "note", text: "Coloured the box", time: 32, step: "s-Colour box" },
    { id: 4, role: "note", text: "Moved the box", time: 33, step: "s-Move box" },
    { id: 5, role: "working", text: "…", time: 70 },
  ];

  it("folds an AI's changes under what it said, and places the rest by time", () => {
    const items = chatHistory(messages, timeline, true);
    expect(items.map((i) => i.key)).toEqual(["r1", "m1", "m2", "g3", "v3", "r4", "r5"]);
    const ai = items[3];
    expect(ai.kind === "changes" && ai.changes.map((c) => c.at)).toEqual([2, 3]);
    expect(ai.kind === "changes" && ai.by).toBe("Claude Code");
  });

  it("keeps the designer's changes apart from an outside AI's", () => {
    const items = chatHistory(messages, timeline, true);
    const runs = items.filter((i) => i.kind === "changes" && i.key.startsWith("r"));
    expect(runs.map((r) => r.kind === "changes" && [r.actor, r.by])).toEqual([["you", undefined], ["you", undefined], ["ai", "Cursor (outside)"]]);
  });

  it("a task shows only what was said in it, and the versions", () => {
    const items = chatHistory(messages, timeline, false);
    expect(items.map((i) => i.key)).toEqual(["m1", "m2", "g3", "v3"]);
  });

  it("joins the designer's steps that follow each other into one run", () => {
    const t: Moment[] = [step("New", 0), step("A", 1), step("B", 2), step("C", 3, { actor: "ai", by: "Claude Code" }), step("D", 4)];
    const items = chatHistory([], t, true);
    expect(items.map((i) => i.kind === "changes" && i.changes.length)).toEqual([2, 1]);
  });

  it("a change whose step was thrown away points nowhere, and stays in its group", () => {
    const t: Moment[] = [step("New", 0), step("A", 1, { actor: "ai", by: "Claude Code" }), step("New B", 3, { actor: "ai", by: "Claude Code" })];
    const said: Msg[] = [
      { id: 1, role: "note", text: "A", time: 1, step: "s-A", undoStep: 1 },
      { id: 2, role: "note", text: "Old B", time: 2, step: "s-gone", undoStep: 2 },
    ];
    const items = chatHistory(said, t, false);
    expect(items).toHaveLength(1);
    expect(items[0].kind === "changes" && items[0].changes.map((c) => c.at)).toEqual([1, -1]);
  });

  it("finds what was said, changes, versions and names", () => {
    const items = chatHistory(messages, timeline, true);
    const nameOf = (by?: string) => (by === "Claude Code" ? "Juniper" : (by ?? ""));
    expect(findInHistory(items, "box", nameOf).map((f) => [f.kind, f.key, f.group])).toEqual([
      ["change", "m4", "g3"],
      ["change", "m3", "g3"],
      ["said", "m1", undefined],
      ["change", "s1", "r1"],
    ]);
    expect(findInHistory(items, "logo", nameOf).map((f) => f.key)).toEqual(["v3"]);
    expect(findInHistory(items, "junip", nameOf)).toEqual([{ key: "m2", kind: "name", text: "Juniper" }]);
    expect(findInHistory(items, "  ", nameOf)).toEqual([]);
  });

  it("a new direction starts its own group", () => {
    const line: Moment[] = [step("New file", 0), step("Draw", 10), step("Move", 20), step("Green", 30, { from: "s-Draw" })];
    const items = chatHistory([], line, true);
    expect(items.map((i) => i.kind === "changes" && i.changes.map((c) => c.at))).toEqual([[1, 2], [3]]);
  });
});
