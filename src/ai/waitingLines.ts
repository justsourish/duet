export const PLAIN_LINE = "Still working. Nothing is wrong. You can keep designing.";

export const WAITING_LINES: string[] = [
  "Thinking…",
  "Hold your horses, pony friend.",
  "Go stretch.",
  "The pixels are being very careful.",
  "Thinking so hard it forgot to blink.",
  "Not stuck. Just dramatic.",
  "Something is happening. Trust the process.",
  "Arguing with a rectangle. The rectangle is losing.",
  "Cooking. Do not open the oven.",
  "Fetching the right shade of blue.",
  "Nobody panic. Someone has the wheel.",
  "Counting pixels. There are a lot.",
  "Almost there. Said every designer, ever.",
  "Still alive in here. Promise.",
  "Teaching an ellipse to behave.",
  "Consulted the color wheel. It was inconclusive.",
  "Just nudging a few vectors.",
];

/**
 * Pick a waiting line to show while an AI works.
 * After 60 seconds (60000 ms), returns the plain reassurance line.
 * Otherwise picks a random line from the starter list that does not repeat the last one.
 */
export function pickWaitingLine(last?: string, elapsed = 0): string {
  const isPlain = elapsed >= 60000;
  if (isPlain) {
    return PLAIN_LINE;
  }
  const pool = last ? WAITING_LINES.filter((line) => line !== last) : WAITING_LINES;
  const candidates = pool.length > 0 ? pool : WAITING_LINES;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

export function formatWaitingLine(tool: string, line: string): string {
  return `${tool}: ${line}`;
}
