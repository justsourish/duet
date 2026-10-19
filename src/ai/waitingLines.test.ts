import { describe, expect, it } from "vitest";
import { pickWaitingLine, PLAIN_LINE, THINKING_LINE } from "./waitingLines";

describe("the line shown while an AI works", () => {
  it("says plain Thinking to begin with", () => {
    expect(pickWaitingLine()).toBe(THINKING_LINE);
    expect(pickWaitingLine(THINKING_LINE, 30000)).toBe(THINKING_LINE);
  });

  it("switches to the calm note after 60 seconds of work", () => {
    expect(pickWaitingLine(THINKING_LINE, 60000)).toBe(PLAIN_LINE);
    expect(pickWaitingLine(undefined, 75000)).toBe(PLAIN_LINE);
  });
});
