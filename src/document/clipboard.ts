import type { Doc, El } from "./types";
import { descendants, topLevelOnly, worldPos } from "./geometry";

/** What travels when you copy: the chosen elements and everything inside them. */
export interface ClipPayload {
  duet: 1;
  rootIds: string[];
  elements: Record<string, El>;
  /** Where each top-level piece sat on the page when it was copied. */
  origins: Record<string, { x: number; y: number }>;
}

/** Pick up elements (in stacking order, back to front) with their contents. */
export function extractPayload(doc: Doc, ids: string[]): ClipPayload | null {
  const roots = topLevelOnly(doc, ids.filter((i) => doc.elements[i]));
  if (roots.length === 0) return null;
  const order = new Map<string, number>();
  let n = 0;
  const walk = (list: string[]) =>
    list.forEach((i) => {
      order.set(i, n++);
      walk(doc.elements[i]?.childIds ?? []);
    });
  walk(doc.rootIds);
  roots.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const elements: Record<string, El> = {};
  const origins: ClipPayload["origins"] = {};
  for (const r of roots) {
    for (const id of [r, ...descendants(doc, r)]) elements[id] = structuredClone(doc.elements[id]);
    origins[r] = worldPos(doc, r);
  }
  return { duet: 1, rootIds: roots, elements, origins };
}

export const payloadToText = (p: ClipPayload) => JSON.stringify(p);

/** Read clipboard text. Returns null when it is not something Duet copied. */
export function textToPayload(text: string): ClipPayload | null {
  try {
    const p = JSON.parse(text) as Partial<ClipPayload>;
    if (p?.duet !== 1 || !Array.isArray(p.rootIds) || !p.elements || !p.origins) return null;
    if (!p.rootIds.every((id) => p.elements![id])) return null;
    return p as ClipPayload;
  } catch {
    return null;
  }
}
