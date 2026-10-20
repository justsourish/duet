import { describe, expect, it } from "vitest";
import { checkLayout } from "./designCheck";
import { emptyDoc } from "../document/types";
import { runCommand } from "../commands";

describe("checkLayout", () => {
  it("returns an empty list for a clean frame", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 120,
      height: 30,
      parentId: "f1",
      props: { text: "Clean Title", fontSize: 20, fill: "#000000" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems).toEqual([]);
  });

  it("returns an empty list for a frame with no text elements", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
    });
    doc = runCommand(doc, "create_element", {
      id: "r1",
      type: "rect",
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      parentId: "f1",
    });

    expect(checkLayout(doc, "f1")).toEqual([]);
  });

  it("detects off-frame text and reports how far in pixels", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // Text right edge sits at 450 + 80 = 530, so 30px outside the frame
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 450,
      y: 100,
      width: 80,
      height: 30,
      parentId: "f1",
      props: { name: "Headline", text: "Headline", fontSize: 20, fill: "#000000" },
    });

    const overhang = Math.round(doc.elements.t1.x + doc.elements.t1.width - 500);
    const problems = checkLayout(doc, "f1");
    expect(problems.length).toBe(1);
    expect(problems[0].kind).toBe("off-frame");
    expect(problems[0].name).toBe("Headline");
    expect(problems[0].message).toContain(`${overhang}px`);
    expect(problems[0].message).toContain("Headline");
    expect(problems[0].message).not.toContain("t1");
  });

  it("detects overlapping text boxes and names both", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      parentId: "f1",
      props: { name: "Heading", text: "Heading", fontSize: 20, fill: "#000000" },
    });
    // Overlaps Heading by 80px x 30px = 2400px^2 (60% of 4000px^2)
    doc = runCommand(doc, "create_element", {
      id: "t2",
      type: "text",
      x: 120,
      y: 110,
      width: 100,
      height: 40,
      parentId: "f1",
      props: { name: "Subheading", text: "Subheading", fontSize: 20, fill: "#000000" },
    });

    const problems = checkLayout(doc, "f1");
    const overlaps = problems.filter((p) => p.kind === "overlap");
    expect(overlaps.length).toBe(1);
    expect(overlaps[0].name).toBe("Heading");
    expect(overlaps[0].message).toContain("Heading");
    expect(overlaps[0].message).toContain("Subheading");
    expect(overlaps[0].message).not.toContain("t1");
    expect(overlaps[0].message).not.toContain("t2");
  });

  it("detects too-small text and says the minimum in pixels", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // 3% of 500 is 15px. Font size 10 is too small.
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 100,
      height: 30,
      parentId: "f1",
      props: { name: "Caption", text: "Caption", fontSize: 10, fill: "#000000" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.length).toBe(1);
    expect(problems[0].kind).toBe("too-small");
    expect(problems[0].name).toBe("Caption");
    expect(problems[0].message).toContain("15px");
    expect(problems[0].message).toContain("Caption");
  });

  it("detects near-edge text that is still inside the frame", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // 4% of 500 is 20px. Text sits at x: 10, so 10px from edge (< 20px)
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 10,
      y: 100,
      width: 100,
      height: 30,
      parentId: "f1",
      props: { name: "Edge Note", text: "Edge Note", fontSize: 20, fill: "#000000" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.length).toBe(1);
    expect(problems[0].kind).toBe("near-edge");
    expect(problems[0].name).toBe("Edge Note");
    expect(problems[0].message).toContain("Edge Note");
    expect(problems[0].message).toContain("edge");
  });

  it("detects low-contrast text against a solid background", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // Light grey text (#cccccc) on white (#ffffff) has contrast ratio ~1.6:1 (< 3)
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 100,
      height: 30,
      parentId: "f1",
      props: { name: "Faint Label", text: "Faint Label", fontSize: 20, fill: "#cccccc" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.length).toBe(1);
    expect(problems[0].kind).toBe("low-contrast");
    expect(problems[0].name).toBe("Faint Label");
    expect(problems[0].message).toContain("Faint Label");
    expect(problems[0].message).toContain("low contrast");
  });

  it("detects low-contrast against a solid shape below the text", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // Dark card
    doc = runCommand(doc, "create_element", {
      id: "c1",
      type: "rect",
      x: 50,
      y: 50,
      width: 300,
      height: 200,
      parentId: "f1",
      props: { fill: "#1b1b1f" },
    });
    // Dark text on dark card
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 120,
      height: 30,
      parentId: "f1",
      props: { name: "Card Text", text: "Card Text", fontSize: 20, fill: "#222226" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.length).toBe(1);
    expect(problems[0].kind).toBe("low-contrast");
    expect(problems[0].name).toBe("Card Text");
  });

  it("skips contrast check when the thing behind is a picture, video or gradient", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // Picture covering the text area
    doc = runCommand(doc, "create_element", {
      id: "img1",
      type: "image",
      x: 50,
      y: 50,
      width: 300,
      height: 300,
      parentId: "f1",
      props: { src: "assets/hero.jpg" },
    });
    // White text over the picture
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 120,
      height: 30,
      parentId: "f1",
      props: { name: "Hero Title", text: "Hero Title", fontSize: 20, fill: "#ffffff" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.filter((p) => p.kind === "low-contrast")).toEqual([]);
  });

  it("skips contrast check when behind is a video clip", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    doc = runCommand(doc, "create_element", {
      id: "v1",
      type: "video",
      x: 50,
      y: 50,
      width: 300,
      height: 300,
      parentId: "f1",
      props: { src: "assets/clip.mp4" },
    });
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 120,
      height: 30,
      parentId: "f1",
      props: { name: "Video Title", text: "Video Title", fontSize: 20, fill: "#ffffff" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.filter((p) => p.kind === "low-contrast")).toEqual([]);
  });

  it("skips contrast check when behind is a gradient shape or frame", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    doc = runCommand(doc, "create_element", {
      id: "g1",
      type: "rect",
      x: 50,
      y: 50,
      width: 300,
      height: 300,
      parentId: "f1",
      props: { gradient: { from: "#000000", to: "#ffffff", angle: 90 } },
    });
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 120,
      height: 30,
      parentId: "f1",
      props: { name: "Gradient Title", text: "Gradient Title", fontSize: 20, fill: "#ffffff" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems.filter((p) => p.kind === "low-contrast")).toEqual([]);
  });

  it("works with text nested inside a group", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    doc = runCommand(doc, "create_element", {
      id: "grp1",
      type: "group",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      parentId: "f1",
    });
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 20,
      y: 20,
      width: 120,
      height: 30,
      parentId: "grp1",
      props: { name: "Grouped Text", text: "Grouped Text", fontSize: 20, fill: "#000000" },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems).toEqual([]);
  });

  it("skips hidden text elements", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    // Off-frame, too-small, and low contrast, but hidden
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 480,
      y: 100,
      width: 100,
      height: 30,
      parentId: "f1",
      props: { name: "Hidden Text", text: "Hidden Text", fontSize: 8, fill: "#ffffff", hidden: true },
    });

    expect(checkLayout(doc, "f1")).toEqual([]);
  });

  it("allows rotated text to be measured by its plain box", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });
    doc = runCommand(doc, "create_element", {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      width: 100,
      height: 30,
      parentId: "f1",
      props: { name: "Angled Text", text: "Angled Text", fontSize: 20, fill: "#000000", rotation: 45 },
    });

    const problems = checkLayout(doc, "f1");
    expect(problems).toEqual([]);
  });

  it("caps problems at 8 and the last message says how many more", () => {
    let doc = runCommand(emptyDoc(), "create_element", {
      id: "f1",
      type: "frame",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      props: { fill: "#ffffff" },
    });

    // Create 10 text elements that are too small (< 15px)
    for (let i = 1; i <= 10; i++) {
      doc = runCommand(doc, "create_element", {
        id: `t${i}`,
        type: "text",
        x: 100,
        y: 30 + i * 35,
        width: 100,
        height: 20,
        parentId: "f1",
        props: { name: `Item ${i}`, text: `Item ${i}`, fontSize: 10, fill: "#000000" },
      });
    }

    const problems = checkLayout(doc, "f1");
    expect(problems.length).toBe(8);
    const last = problems[7];
    expect(last.message).toContain("2 more problems");
  });
});
