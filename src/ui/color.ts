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
