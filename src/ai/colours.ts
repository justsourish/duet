/**
 * The colour of whoever did something. The history line and the chat both use it, so an agent has
 * one colour everywhere: the designer is white, Duet's own AI is orange, and any AI that says its
 * name gets a colour of its own that never changes for that name.
 */
const AI_PALETTE = ["#35c9b5", "#5aa9ff", "#e6c14a", "#c58bff", "#7ed957"];

export function agentColour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AI_PALETTE[(h >>> 0) % AI_PALETTE.length];
}

export function whoColour(actor: "you" | "ai", by?: string): string {
  if (actor === "you") return "var(--text)";
  return by ? agentColour(by) : "var(--duet)";
}
