import { describe, expect, it } from "vitest";
import { checkExport } from "./exportCheck";

describe("checkExport", () => {
  it("accepts a full path to a png and defaults the scale to 1", () => {
    expect(checkExport(" ~/Desktop/cover.png ", undefined, 1584, 396)).toEqual({ path: "~/Desktop/cover.png", scale: 1 });
    expect(checkExport("C:\\Users\\a\\cover.PNG", 2, 1584, 396)).toEqual({ path: "C:\\Users\\a\\cover.PNG", scale: 2 });
  });

  it("refuses a path that is not full, not a png, or hidden", () => {
    for (const bad of ["cover.png", "~/Desktop/cover.jpg", "/a/../b/cover.png", "~/.ssh/cover.png", "/Users/a/.duet/x.png", 5, undefined]) {
      expect("error" in checkExport(bad, 1, 100, 100), String(bad)).toBe(true);
    }
  });

  it("holds the scale and the final size to sensible limits", () => {
    expect("error" in checkExport("/a/b.png", 0, 100, 100)).toBe(true);
    expect("error" in checkExport("/a/b.png", 5, 100, 100)).toBe(true);
    expect("error" in checkExport("/a/b.png", "2", 100, 100)).toBe(true);
    expect("error" in checkExport("/a/b.png", 4, 3000, 100)).toBe(true);
    expect("error" in checkExport("/a/b.png", 4, 2048, 100)).toBe(false);
  });
});
