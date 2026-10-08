import { useSyncExternalStore } from "react";

/** Where the panels and the chat sit. Kept per person, on this computer. */

export type Corner = "tl" | "tr" | "bl" | "br";

export interface Dock {
  leftW: number;
  rightW: number;
  leftHidden: boolean;
  rightHidden: boolean;
  /** Layers on the right and the design panel on the left. */
  swapped: boolean;
  /** The chat sits in a corner, or wherever it was dropped. */
  chat: { corner: Corner } | { x: number; y: number };
  /** How wide the chat is, and how tall its message area is. */
  chatW: number;
  chatH: number;
}

const KEY = "duet:layout";
export const MIN_W = 180;
export const MAX_W = 460;
export const defaults = (): Dock => ({ leftW: 232, rightW: 248, leftHidden: false, rightHidden: false, swapped: false, chat: { corner: "br" }, chatW: 320, chatH: 340 });
export const CHAT_MIN = { w: 280, h: 140 };
export const CHAT_MAX = { w: 720, h: 900 };

function load(): Dock {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Dock> | null;
    if (raw && typeof raw === "object") return { ...defaults(), ...raw };
  } catch {
    /* start fresh */
  }
  return defaults();
}

let state: Dock = load();
const listeners = new Set<() => void>();

export const getLayout = () => state;

export function setLayout(patch: Partial<Dock>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const resetLayout = () => setLayout(defaults());

export function useLayout<T>(selector: (d: Dock) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => selector(state),
  );
}

export const clampW = (n: number) => Math.max(MIN_W, Math.min(MAX_W, Math.round(n)));
