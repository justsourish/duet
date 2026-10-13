import { describe, expect, it } from "vitest";
import { stepMessage } from "../project/project";
import { fromChat, toolName } from "./who";

describe("which AI tool is at work", () => {
  it("gives a known tool the name a designer knows", () => {
    expect(toolName("claude-code")).toBe("Claude Code");
    expect(toolName("claude-ai")).toBe("Claude");
    expect(toolName("codex-mcp-client")).toBe("Codex");
    expect(toolName("cursor-vscode")).toBe("Cursor");
    expect(toolName("antigravity-client")).toBe("Antigravity");
  });

  it("keeps an unknown tool's own name, tidied", () => {
    expect(toolName("my-mcp_client")).toBe("My mcp client");
  });

  it("has no name for a tool that did not say one", () => {
    expect(toolName(null)).toBeUndefined();
    expect(toolName("  ")).toBeUndefined();
  });

  it("knows a tool started from Duet's own chat", () => {
    expect(fromChat("chat:Claude Code")).toBe(true);
    expect(toolName("chat:Claude Code")).toBe("Claude Code");
    expect(fromChat("claude-code")).toBe(false);
  });
});

describe("a saved step says which AI tool made it", () => {
  it("adds the name on its own line, for an AI step only", () => {
    expect(stepMessage({ label: "Add rectangle", actor: "ai", by: "Claude Code" }, false)).toBe("Add rectangle\n\nActor: ai\nBy: Claude Code");
    expect(stepMessage({ label: "Add rectangle", actor: "ai" }, false)).toBe("Add rectangle\n\nActor: ai");
    expect(stepMessage({ label: "Move", actor: "you", by: "Claude Code" }, false)).toBe("Move\n\nActor: you");
  });

  it("keeps a name with a line break in it on one line", () => {
    expect(stepMessage({ label: "Move", actor: "ai", by: "Odd\nSteps: x" }, false)).toBe("Move\n\nActor: ai\nBy: Odd Steps: x");
  });
});
