import { currentDoc, dispatch, getState } from "../state/store";
import { sceneOf } from "../document/time";
import type { Moving } from "../document/types";
import { getLayout, setLayout } from "../ui/layout";

/**
 * Marking a moment by hand. With Option held: P for position, S for size, T for opacity, R for turn.
 * It marks the value the selected things have at the playhead. After that, changing them at another
 * moment marks that moment too, and they move between the two. Pressed again on a mark, it takes it away.
 * Option U shows every mark in the timeline, one row for each kind of change.
 */
const MARKS: Record<string, Moving[]> = { KeyP: ["x", "y"], KeyS: ["width", "height"], KeyT: ["opacity"], KeyR: ["rotation"] };

let wired = false;
export function wireKeys() {
  if (wired) return;
  wired = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code === "KeyU" && e.altKey && !e.metaKey && !e.ctrlKey && getState().clock.scene) {
        // Option U opens every thing that moves into a row for each kind of change, and folds them again
        e.preventDefault();
        e.stopPropagation();
        setLayout({ keysOpen: !getLayout().keysOpen });
        return;
      }
      const props = MARKS[e.code];
      if (!props || !e.altKey || e.metaKey || e.ctrlKey) return;
      const s = getState();
      const scene = s.clock.scene;
      if (!scene) return;
      const doc = currentDoc(s);
      const ids = s.selection.filter((id) => id !== scene && sceneOf(doc, id)?.id === scene);
      if (!ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      const t = Math.round(s.clock.t * 1000) / 1000;
      const marked = ids.every((id) => props.every((p) => doc.elements[id].keys[p]?.some((k) => Math.abs(k.t - t) < 0.004)));
      if (marked) dispatch("remove_key", { ids, props, t });
      else dispatch("key_now", { ids, props, t });
    },
    true,
  );
}
