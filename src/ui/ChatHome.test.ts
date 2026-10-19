import { describe, expect, it } from "vitest";
import { matchProjects, sortProjects } from "./ChatHome";

describe("projects beside the chat", () => {
  const all = [{ name: "Poster for Kapil" }, { name: "Site" }, { name: "kapil logo" }];
  it("lists every project when nothing is typed", () => {
    expect(matchProjects(all, "  ")).toHaveLength(3);
  });
  it("finds by part of the name, ignoring capitals", () => {
    expect(matchProjects(all, "KAPIL").map((r) => r.name)).toEqual(["Poster for Kapil", "kapil logo"]);
    expect(matchProjects(all, "zzz")).toEqual([]);
  });

  it("sorts by last opened or by name", () => {
    const some = [
      { name: "b", opened: 1 },
      { name: "A", opened: 3 },
      { name: "c", opened: 2 },
    ];
    expect(sortProjects(some, "recent").map((r) => r.name)).toEqual(["A", "c", "b"]);
    expect(sortProjects(some, "name").map((r) => r.name)).toEqual(["A", "b", "c"]);
    expect(some[0].name).toBe("b");
  });
});
