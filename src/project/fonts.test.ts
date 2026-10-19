import { describe, expect, it } from "vitest";
import { matchOnline, parseFontFile, type OnlineFont } from "./fonts";

const font = (family: string, category = "sans-serif"): OnlineFont => ({ id: family.toLowerCase().replace(/ /g, "-"), family, category, weights: [400], subsets: ["latin"], defSubset: "latin" });

describe("fonts from Fontsource", () => {
  it("reads the family and weight from a font file in a project", () => {
    expect(parseFontFile("font-Open Sans-700.woff2")).toEqual({ family: "Open Sans", weight: 700 });
    expect(parseFontFile("font-Roboto-Slab-400.woff2")).toEqual({ family: "Roboto-Slab", weight: 400 });
    expect(parseFontFile("photo.png")).toBeNull();
  });

  it("offers nothing until something is typed, and skips fonts the computer already has", () => {
    const all = [font("Inter"), font("Playfair Display", "serif"), font("Arial")];
    expect(matchOnline(all, "", new Set())).toEqual([]);
    expect(matchOnline(all, "play", new Set()).map((f) => f.family)).toEqual(["Playfair Display"]);
    expect(matchOnline(all, "ar", new Set(["arial"])).map((f) => f.family)).toEqual([]);
  });

  it("finds by feel: the kind of font", () => {
    const all = [font("Inter"), font("Lora", "handwriting")];
    expect(matchOnline(all, "hand", new Set()).map((f) => f.family)).toEqual(["Lora"]);
  });
});
