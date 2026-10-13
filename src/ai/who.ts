/** Which AI tool is at work. Each one says a short name for itself when it connects; this turns it into the name a designer knows. */

const KNOWN: [RegExp, string][] = [
  [/claude[\s-]*code/i, "Claude Code"],
  [/claude/i, "Claude"],
  [/antigravity|^agy\b|jetski/i, "Antigravity"],
  [/codex/i, "Codex"],
  [/cursor/i, "Cursor"],
  [/opencode/i, "OpenCode"],
  [/gemini/i, "Gemini"],
  [/copilot|vscode|visual studio code/i, "VS Code"],
  [/windsurf/i, "Windsurf"],
  [/zed/i, "Zed"],
];

/** A tool started from Duet's own chat marks itself this way, so it is not taken for one working from outside. */
export const FROM_CHAT = "chat:";

export const fromChat = (client: string | null | undefined) => !!client && client.startsWith(FROM_CHAT);

/** The name to show for an AI tool, or undefined when it did not say who it is. */
export function toolName(client: string | null | undefined): string | undefined {
  const raw = (client ?? "").replace(FROM_CHAT, "").trim();
  if (!raw) return undefined;
  for (const [like, name] of KNOWN) if (like.test(raw)) return name;
  // an unknown tool keeps its own name, tidied: "my-mcp-client" reads "My mcp client"
  const words = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
