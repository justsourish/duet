import { describe, expect, it } from "vitest";
import { emptyDoc } from "../document/types";
import { FRAME_PRESETS, createPresetFrame } from "./presets";
import { commandLabel, runCommand } from "./index";

describe("frame presets", () => {
  it("defines the standard 8 presets with exact sizes", () => {
    expect(FRAME_PRESETS).toEqual([
      { name: "Phone", width: 390, height: 844 },
      { name: "Tablet", width: 820, height: 1180 },
      { name: "Desktop", width: 1440, height: 900 },
      { name: "Poster", width: 1080, height: 1350 },
      { name: "Square post", width: 1080, height: 1080 },
      { name: "Story", width: 1080, height: 1920 },
      { name: "Video", width: 1920, height: 1080 },
      { name: "Slide", width: 1920, height: 1080 },
    ]);
  });

  it("creates a frame in the center of coordinates without mutating the original document", () => {
    const initial = emptyDoc();
    const phonePreset = FRAME_PRESETS[0];
    const center = { x: 500, y: 400 };

    const next = createPresetFrame(initial, { preset: phonePreset, center, id: "phone-1" });

    // Does not mutate the original document
    expect(initial.rootIds).toEqual([]);
    expect(Object.keys(initial.elements)).toEqual([]);

    // New document has the centered frame
    expect(next.rootIds).toEqual(["phone-1"]);
    const el = next.elements["phone-1"];
    expect(el).toBeDefined();
    expect(el.type).toBe("frame");
    expect(el.name).toBe("Phone");
    expect(el.width).toBe(390);
    expect(el.height).toBe(844);
    // Center at (500, 400) -> x = 500 - 390/2 = 305, y = 400 - 844/2 = -22
    expect(el.x).toBe(305);
    expect(el.y).toBe(-22);
    expect(el.x + el.width / 2).toBe(center.x);
    expect(el.y + el.height / 2).toBe(center.y);
  });

  it("creates frames with explicit coordinates", () => {
    const doc = emptyDoc();
    const desktopPreset = FRAME_PRESETS[2]; // Desktop 1440 x 900

    const next = createPresetFrame(doc, { preset: desktopPreset, x: 100, y: 200, id: "desk-1" });

    const el = next.elements["desk-1"];
    expect(el.x).toBe(100);
    expect(el.y).toBe(200);
    expect(el.width).toBe(1440);
    expect(el.height).toBe(900);
    expect(el.name).toBe("Desktop");
  });

  it("works through runCommand registry", () => {
    const doc = emptyDoc();
    const poster = FRAME_PRESETS[3]; // Poster 1080 x 1350
    const center = { x: 1000, y: 1000 };

    const next = runCommand(doc, "create_preset_frame", {
      preset: poster,
      center,
      id: "poster-1",
    });

    expect(next.rootIds).toContain("poster-1");
    const el = next.elements["poster-1"];
    expect(el.type).toBe("frame");
    expect(el.width).toBe(1080);
    expect(el.height).toBe(1350);
    expect(el.name).toBe("Poster");
    expect(el.x).toBe(1000 - 1080 / 2);
    expect(el.y).toBe(1000 - 1350 / 2);

    expect(commandLabel("create_preset_frame", { preset: poster })).toBe("Add poster frame");
  });

  it("creates all 8 preset sizes correctly", () => {
    let doc = emptyDoc();
    const center = { x: 0, y: 0 };

    for (const preset of FRAME_PRESETS) {
      doc = createPresetFrame(doc, { preset, center });
    }

    expect(doc.rootIds).toHaveLength(8);
    for (let i = 0; i < FRAME_PRESETS.length; i++) {
      const preset = FRAME_PRESETS[i];
      const id = doc.rootIds[i];
      const el = doc.elements[id];
      expect(el.type).toBe("frame");
      expect(el.width).toBe(preset.width);
      expect(el.height).toBe(preset.height);
      expect(el.x).toBe(Math.round(center.x - preset.width / 2));
      expect(el.y).toBe(Math.round(center.y - preset.height / 2));
    }
  });
});
