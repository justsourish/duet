import { describe, expect, it } from "vitest";
import { matchProjects } from "./ChatHome";

describe("projects beside the chat", () => {
  const all = [{ name: "Poster for Kapil" }, { name: "Site" }, { name: "kapil logo" }];
  it("lists every project when nothing is typed", () => {
    expect(matchProjects(all, "  ")).toHaveLength(3);
  });
  it("finds by part of the name, ignoring capitals", () => {
    expect(matchProjects(all, "KAPIL").map((r) => r.name)).toEqual(["Poster for Kapil", "kapil logo"]);
    expect(matchProjects(all, "zzz")).toEqual([]);
  });
});
