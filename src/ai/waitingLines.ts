/** What the chat says while an AI works: plain "Thinking", and a calm note once it takes a minute. */
export const THINKING_LINE = "Thinking";
export const PLAIN_LINE = "Still working. Nothing is wrong. You can keep designing.";

/** After 60 seconds (60000 ms) the calm note, before that just Thinking. */
export function pickWaitingLine(_last?: string, elapsed = 0): string {
  return elapsed >= 60000 ? PLAIN_LINE : THINKING_LINE;
}

export function formatWaitingLine(tool: string, line: string): string {
  return `${tool}: ${line}`;
}
