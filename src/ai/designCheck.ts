import { descendants, pointInRect, worldRect } from "../document/geometry";
import type { Doc, El } from "../document/types";

export interface LayoutProblem {
  id: string;
  name: string;
  kind: "off-frame" | "overlap" | "too-small" | "near-edge" | "low-contrast";
  message: string;
}

/** Parse hex color into RGB. Returns null for non-solid, transparent, or unparseable colors. */
function parseSolidHex(color: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (!c.startsWith("#")) return null;
  const raw = c.slice(1);
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16),
    };
  }
  if (raw.length === 6) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  if (raw.length === 8) {
    const alpha = parseInt(raw.slice(6, 8), 16);
    if (alpha < 255) return null; // not solid
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

function channelLuminance(val: number): number {
  const c = val / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Calculate WCAG contrast ratio between two solid colors. Returns null if either cannot be parsed. */
function wcagContrast(fgColor: string, bgColor: string): number | null {
  const fg = parseSolidHex(fgColor);
  const bg = parseSolidHex(bgColor);
  if (!fg || !bg) return null;
  const l1 = luminance(fg.r, fg.g, fg.b);
  const l2 = luminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check if an element is visible and drawn on screen within the frame. */
function isVisible(doc: Doc, el: El, frameId: string): boolean {
  if (el.hidden || el.opacity <= 0) return false;
  if (el.width <= 0 || el.height <= 0) return false;
  if (el.type === "text" && (!el.text || el.text.trim().length === 0)) return false;

  let cur = el.parentId ? doc.elements[el.parentId] : null;
  while (cur && cur.id !== frameId) {
    if (cur.hidden || cur.opacity <= 0) return false;
    cur = cur.parentId ? doc.elements[cur.parentId] : null;
  }
  return true;
}

/** Find the solid fill directly behind a text element, or "skip" if behind is picture/video/gradient. */
function findBackgroundFill(doc: Doc, frame: El, textEl: El, stackOrder: string[]): string | "skip" | null {
  const textRect = worldRect(doc, textEl.id);
  const cx = textRect.x + textRect.width / 2;
  const cy = textRect.y + textRect.height / 2;

  const textIndex = stackOrder.indexOf(textEl.id);
  for (let i = textIndex - 1; i >= 0; i--) {
    const el = doc.elements[stackOrder[i]];
    if (!el || el.type === "sound") continue;
    if (!isVisible(doc, el, frame.id)) continue;

    const r = worldRect(doc, el.id);
    if (!pointInRect(cx, cy, r)) continue;

    if (el.type === "image" || el.type === "video") return "skip";
    if (el.gradient) return "skip";
    if (el.type === "group" || el.type === "text") continue;

    if (el.opacity >= 1 && parseSolidHex(el.fill)) {
      return el.fill;
    }
    if (el.opacity < 1 && el.fill && el.fill !== "#00000000" && el.fill !== "#ffffff00") {
      return "skip";
    }
  }

  if (frame.gradient) return "skip";
  if (frame.opacity >= 1 && parseSolidHex(frame.fill)) {
    return frame.fill;
  }
  return null;
}

export function checkLayout(doc: Doc, frameId: string): LayoutProblem[] {
  const frame = doc.elements[frameId];
  if (!frame || frame.type !== "frame" || frame.hidden || frame.opacity <= 0 || frame.width <= 0 || frame.height <= 0) {
    return [];
  }

  const allDescendants = descendants(doc, frameId);
  const textEls = allDescendants
    .map((id) => doc.elements[id])
    .filter((el): el is El => !!el && el.type === "text" && isVisible(doc, el, frameId));

  if (textEls.length === 0) return [];

  const fRect = worldRect(doc, frameId);
  const shorterSide = Math.min(fRect.width, fRect.height);
  const minFontSize = shorterSide * 0.03;
  const edgeMarginThreshold = shorterSide * 0.04;

  const problems: LayoutProblem[] = [];
  const seenOverlapPairs = new Set<string>();

  for (const text of textEls) {
    const tRect = worldRect(doc, text.id);

    // 1. off-frame: any part of the text box outside the frame
    const leftOverhang = fRect.x - tRect.x;
    const topOverhang = fRect.y - tRect.y;
    const rightOverhang = tRect.x + tRect.width - (fRect.x + fRect.width);
    const bottomOverhang = tRect.y + tRect.height - (fRect.y + fRect.height);
    const maxOverhang = Math.max(leftOverhang, topOverhang, rightOverhang, bottomOverhang);
    const isOffFrame = maxOverhang > 1e-4;

    if (isOffFrame) {
      const dist = Math.max(1, Math.round(maxOverhang));
      problems.push({
        id: text.id,
        name: text.name,
        kind: "off-frame",
        message: `${text.name} is ${dist}px outside the frame.`,
      });
    }

    // 2. overlap: overlaps another text box by more than 10% of the smaller one
    const area = tRect.width * tRect.height;
    for (const other of textEls) {
      if (other.id === text.id) continue;
      const pairKey = [text.id, other.id].sort().join("::");
      if (seenOverlapPairs.has(pairKey)) continue;

      const oRect = worldRect(doc, other.id);
      const otherArea = oRect.width * oRect.height;
      const smallerArea = Math.min(area, otherArea);

      const ix = Math.max(0, Math.min(tRect.x + tRect.width, oRect.x + oRect.width) - Math.max(tRect.x, oRect.x));
      const iy = Math.max(0, Math.min(tRect.y + tRect.height, oRect.y + oRect.height) - Math.max(tRect.y, oRect.y));
      const overlapArea = ix * iy;

      if (smallerArea > 0 && overlapArea > 0.1 * smallerArea) {
        seenOverlapPairs.add(pairKey);
        problems.push({
          id: text.id,
          name: text.name,
          kind: "overlap",
          message: `${text.name} overlaps ${other.name}.`,
        });
      }
    }

    // 3. too-small: font size under 3% of the frame's shorter side
    if (text.fontSize < minFontSize) {
      const minPixels = Math.ceil(minFontSize);
      problems.push({
        id: text.id,
        name: text.name,
        kind: "too-small",
        message: `${text.name} is too small. It should be at least ${minPixels}px.`,
      });
    }

    // 4. near-edge: closer than 4% of the shorter side to a frame edge but still inside
    if (!isOffFrame) {
      const dLeft = tRect.x - fRect.x;
      const dTop = tRect.y - fRect.y;
      const dRight = fRect.x + fRect.width - (tRect.x + tRect.width);
      const dBottom = fRect.y + fRect.height - (tRect.y + tRect.height);
      const minEdgeDist = Math.min(dLeft, dTop, dRight, dBottom);

      if (minEdgeDist < edgeMarginThreshold) {
        problems.push({
          id: text.id,
          name: text.name,
          kind: "near-edge",
          message: `${text.name} is too close to the edge of the frame.`,
        });
      }
    }

    // 5. low-contrast: WCAG contrast ratio under 3 against solid background
    const bgFill = findBackgroundFill(doc, frame, text, allDescendants);
    if (bgFill && bgFill !== "skip") {
      const ratio = wcagContrast(text.fill, bgFill);
      if (ratio !== null && ratio < 3) {
        problems.push({
          id: text.id,
          name: text.name,
          kind: "low-contrast",
          message: `${text.name} has low contrast against its background.`,
        });
      }
    }
  }

  // Cap at 8 problems; if more, the last one says how many more
  if (problems.length > 8) {
    const extra = problems.length - 8;
    const capped = problems.slice(0, 8);
    const last = capped[7];
    capped[7] = {
      ...last,
      message: `${last.message} (${extra} more problem${extra === 1 ? "" : "s"})`,
    };
    return capped;
  }

  return problems;
}
