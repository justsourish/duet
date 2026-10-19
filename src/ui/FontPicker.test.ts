import { describe, expect, it } from "vitest";
import { matchFonts } from "./FontPicker";

describe("finding a font by typing", () => {
  const all = ["Arial", "Avenir Next", "Futura", "Helvetica Neue", "Neue Haas Grotesk"];

  it("offers every font before anything is typed", () => {
    expect(matchFonts(all, "")).toEqual(all);
  });

  it("puts fonts that start with the words first, then those that hold them", () => {
    expect(matchFonts(all, "neue")).toEqual(["Neue Haas Grotesk", "Helvetica Neue"]);
  });

  it("does not care about capitals", () => {
    expect(matchFonts(all, "FUT")).toEqual(["Futura"]);
  });
});
