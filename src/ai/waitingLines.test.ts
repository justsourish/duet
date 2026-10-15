import { describe, expect, it } from "vitest";
import { pickWaitingLine, PLAIN_LINE, WAITING_LINES } from "./waitingLines";

describe("waiting lines while an AI works", () => {
  it("picks a witty line from the starter list", () => {
    const line = pickWaitingLine();
    expect(WAITING_LINES).toContain(line);
  });

  it("never repeats the last line", () => {
    let prev = pickWaitingLine();
    for (let i = 0; i < 100; i++) {
      const next = pickWaitingLine(prev);
      expect(next).not.toBe(prev);
      expect(WAITING_LINES).toContain(next);
      prev = next;
    }
  });

  it("switches to the plain line after 60 seconds of work", () => {
    expect(pickWaitingLine("Go stretch.", 60000)).toBe(PLAIN_LINE);
    expect(pickWaitingLine("Go stretch.", 75000)).toBe(PLAIN_LINE);
    expect(pickWaitingLine(undefined, 60000)).toBe(PLAIN_LINE);
    expect(pickWaitingLine("Go stretch.", 60)).toBe(PLAIN_LINE);
    expect(pickWaitingLine(undefined, 90)).toBe(PLAIN_LINE);
  });

  it("keeps picking witty lines before 60 seconds", () => {
    const line = pickWaitingLine("Go stretch.", 30000);
    expect(WAITING_LINES).toContain(line);
    expect(line).not.toBe("Go stretch.");
    expect(line).not.toBe(PLAIN_LINE);
  });
});
