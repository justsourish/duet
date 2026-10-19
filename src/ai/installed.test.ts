import { describe, expect, it } from "vitest";
import { getChat, setInstalled } from "./chat";

describe("which AI tool answers on a new computer", () => {
  it("answers with a tool that is installed, not the first one on the list", () => {
    setInstalled({ claude: false, agy: true, codex: false, opencode: false });
    expect(getChat().agent).toBe("agy");
    expect(getChat().agentFound).toBe(true);
  });

  it("says nothing is found when no tool is installed", () => {
    setInstalled({ claude: false, agy: false, codex: false, opencode: false });
    expect(getChat().agentFound).toBe(false);
  });

  it("keeps the tool picked before when it is still there", () => {
    setInstalled({ claude: true, agy: true });
    expect(getChat().agent).toBe("agy");
  });
});
