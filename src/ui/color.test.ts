import { describe, expect, it } from "vitest";
import { applyColorPreservingOpacity, colorHex, colorOpacity, docColors, hexToHsva, hsvaToHex, withOpacity } from "./color";

describe("color helpers for fill and stroke opacity", () => {
  describe("colorHex", () => {
    it("returns plain 6-digit hex for 6-digit hex inputs", () => {
      expect(colorHex("#112233")).toBe("#112233");
      expect(colorHex("#AABBCC")).toBe("#aabbcc");
    });

    it("strips alpha from 8-digit hex", () => {
      expect(colorHex("#11223380")).toBe("#112233");
      expect(colorHex("#ff000066")).toBe("#ff0000");
    });

    it("expands 3-digit and 4-digit hex", () => {
      expect(colorHex("#f00")).toBe("#ff0000");
      expect(colorHex("#f008")).toBe("#ff0000");
    });

    it("handles null, undefined, or empty", () => {
      expect(colorHex(null)).toBe("");
      expect(colorHex(undefined)).toBe("");
      expect(colorHex("")).toBe("");
    });
  });

  describe("colorOpacity", () => {
    it("returns 100 for plain 6-digit hex or shorthand without alpha", () => {
      expect(colorOpacity("#112233")).toBe(100);
      expect(colorOpacity("#fff")).toBe(100);
      expect(colorOpacity(null)).toBe(100);
      expect(colorOpacity(undefined)).toBe(100);
    });

    it("extracts opacity percentage from 8-digit hex", () => {
      expect(colorOpacity("#112233ff")).toBe(100);
      expect(colorOpacity("#11223366")).toBe(40);
      expect(colorOpacity("#11223380")).toBe(50);
      expect(colorOpacity("#11223300")).toBe(0);
    });

    it("extracts opacity percentage from 4-digit hex", () => {
      expect(colorOpacity("#f00f")).toBe(100);
      expect(colorOpacity("#f000")).toBe(0);
    });
  });

  describe("withOpacity", () => {
    it("writes plain 6-digit hex when opacity is 100%", () => {
      expect(withOpacity("#112233", 100)).toBe("#112233");
      expect(withOpacity("#11223366", 100)).toBe("#112233");
    });

    it("appends alpha hex when opacity is less than 100%", () => {
      expect(withOpacity("#112233", 40)).toBe("#11223366");
      expect(withOpacity("#112233", 50)).toBe("#11223380");
      expect(withOpacity("#112233", 0)).toBe("#11223300");
    });

    it("clamps opacity between 0 and 100", () => {
      expect(withOpacity("#112233", -10)).toBe("#11223300");
      expect(withOpacity("#112233", 120)).toBe("#112233");
    });

    it("round-trips all integers from 0 to 100 percent accurately", () => {
      for (let p = 0; p <= 100; p++) {
        const hex = withOpacity("#336699", p);
        expect(colorOpacity(hex)).toBe(p);
      }
    });
  });

  describe("applyColorPreservingOpacity", () => {
    it("preserves existing opacity when picking a new 6-digit color", () => {
      expect(applyColorPreservingOpacity("#00ff00", "#ff000066")).toBe("#00ff0066");
      expect(applyColorPreservingOpacity("#00ff00", "#ff0000")).toBe("#00ff00");
    });

    it("defaults to 100% opacity when current color is null", () => {
      expect(applyColorPreservingOpacity("#00ff00", null)).toBe("#00ff00");
    });

    it("adopts explicitly typed 8-digit hex alpha", () => {
      expect(applyColorPreservingOpacity("#00ff0080", "#ff000066")).toBe("#00ff0080");
    });
  });
});

describe("the colour picker's colour model", () => {
  it("goes to hue, saturation and brightness and back unchanged", () => {
    for (const c of ["#000000", "#ffffff", "#ff0000", "#7c5cff", "#35c9b5", "#12345680"]) {
      expect(hsvaToHex(hexToHsva(c))).toBe(c);
    }
  });

  it("reads pure red as hue 0, full saturation and brightness", () => {
    expect(hexToHsva("#ff0000")).toEqual({ h: 0, s: 1, v: 1, a: 1 });
  });

  it("falls back to solid black for something that is not a colour", () => {
    expect(hexToHsva("nope")).toEqual({ h: 0, s: 0, v: 0, a: 1 });
  });
});

describe("docColors", () => {
  it("lists the colours a design uses, most used first, without see-through or repeats", () => {
    const doc = {
      background: "#141417",
      elements: {
        a: { fill: "#FF0000", stroke: null },
        b: { fill: "#ff000080", stroke: "#00ff00" },
        c: { fill: "#0000ff", stroke: null, gradient: { from: "#ff0000", to: "#ffffff" } },
      },
    };
    expect(docColors(doc)).toEqual(["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#141417"]);
  });
});
