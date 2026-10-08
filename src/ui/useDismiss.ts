import { useEffect } from "react";

/**
 * Close a popup when you click anywhere outside it, or press Escape.
 * `inside` is a CSS selector for the popup and the button that opens it, so those clicks are left alone.
 */
export function useDismiss(open: boolean, close: () => void, inside: string) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(inside)) return;
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inside]);
}
