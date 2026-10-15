import { describe, expect, it } from "vitest";
import { connectHelp } from "./agent";

describe("connectHelp", () => {
  it("says agy could not start, and gives the command to run by hand", () => {
    const text = connectHelp("Could not start agy: No such file or directory (os error 2)", "/Applications/Duet.app/Contents/MacOS/duet-app");
    expect(text).toContain("could not start Antigravity");
    expect(text).toContain('agy mcp add duet "/Applications/Duet.app/Contents/MacOS/duet-app" --mcp-bridge');
  });

  it("passes on what Antigravity said for any other failure", () => {
    const text = connectHelp("config is read only", "C:\\Duet\\duet-app.exe");
    expect(text).toContain("Antigravity said: config is read only");
    expect(text).toContain("agy mcp add duet");
  });

  it("still helps when Duet does not know its own path", () => {
    expect(connectHelp("", "")).toBe("Duet could not connect itself to Antigravity.");
  });
});
