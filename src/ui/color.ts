/**
 * Helpers for colors with alpha opacity stored as 8-digit hex (#rrggbbaa).
 * 100% opacity writes plain 6-digit hex (#rrggbb).
 */

/** Extract 6-digit hex (#rrggbb) without alpha, for color pickers and normal color inputs. */
export function colorHex(color: string | null | undefined): string {
  if (!color) return "";
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    const raw = trimmed.slice(1);
    if (raw.length === 3 || raw.length === 4) {
      return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    }
    if (raw.length >= 6) {
      return `#${raw.slice(0, 6)}`;
    }
  }
  return trimmed;
}

/** Extract opacity as a percentage integer 0-100 from a color hex string. */
export function colorOpacity(color: string | null | undefined): number {
  if (!color) return 100;
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    const raw = trimmed.slice(1);
    if (raw.length === 8) {
      const alpha = parseInt(raw.slice(6, 8), 16);
      return Number.isNaN(alpha) ? 100 : Math.round((alpha / 255) * 100);
    }
    if (raw.length === 4) {
      const alpha = parseInt(`${raw[3]}${raw[3]}`, 16);
      return Number.isNaN(alpha) ? 100 : Math.round((alpha / 255) * 100);
    }
  }
  return 100;
}

/** Combine a color with an opacity percentage (0-100). 100% writes plain 6-digit hex. */
export function withOpacity(color: string, opacity: number): string {
  const base = colorHex(color);
  if (!base || !/^#[0-9a-f]{6}$/i.test(base)) return color;
  const clamped = Math.max(0, Math.min(100, Math.round(opacity)));
  if (clamped >= 100) return base;
  const alpha = Math.round((clamped / 100) * 255);
  if (alpha >= 255) return base;
  const alphaHex = alpha.toString(16).padStart(2, "0");
  return `${base}${alphaHex}`;
}

/**
 * When picking a new colour, keep the opacity the designer already set,
 * unless the designer explicitly typed an 8-digit hex containing alpha.
 */
export function applyColorPreservingOpacity(newColor: string, currentColor: string | null | undefined): string {
  const trimmed = newColor.trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return withOpacity(trimmed, colorOpacity(trimmed));
  }
  const currentOp = colorOpacity(currentColor);
  return withOpacity(newColor, currentOp);
}

export interface Hsva {
  /** 0 to 360 */
  h: number;
  /** 0 to 1 */
  s: number;
  /** 0 to 1 */
  v: number;
  /** 0 to 1 */
  a: number;
}

/** A hex colour, with or without see-through, as hue, saturation, brightness and alpha. Falls back to black. */
export function hexToHsva(color: string | null | undefined): Hsva {
  const hex = colorHex(color);
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, v: 0, a: 1 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max, a: colorOpacity(color) / 100 };
}

/** Hue, saturation, brightness and alpha back to hex. Fully solid writes plain 6-digit hex. */
export function hsvaToHex({ h, s, v, a }: Hsva): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  const to = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  return withOpacity(`#${to(f(5))}${to(f(3))}${to(f(1))}`, a * 100);
}

/** The colours a design already uses, most used first, without see-through and without repeats. */
export function docColors(doc: { background?: string; elements: Record<string, { fill?: string; stroke?: string | null; gradient?: { from: string; to: string } | null }> }, max = 18): string[] {
  const count = new Map<string, number>();
  const add = (c: string | null | undefined) => {
    const hex = colorHex(c);
    if (/^#[0-9a-f]{6}$/.test(hex)) count.set(hex, (count.get(hex) ?? 0) + 1);
  };
  for (const el of Object.values(doc.elements)) {
    add(el.fill);
    add(el.stroke);
    add(el.gradient?.from);
    add(el.gradient?.to);
  }
  add(doc.background);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}
