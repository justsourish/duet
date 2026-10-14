import { useSyncExternalStore } from "react";

/** The moment a designer last picked in the timeline or in the panel, so the speed graph can show the move that ends there. */
export interface KeyFocus {
  id: string;
  t: number;
}

let focus: KeyFocus | null = null;
const listeners = new Set<() => void>();

export function setKeyFocus(next: KeyFocus | null) {
  focus = next;
  listeners.forEach((l) => l());
}

export function useKeyFocus(): KeyFocus | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => focus,
  );
}
