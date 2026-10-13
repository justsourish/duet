import { currentDoc, dispatch, getState } from "../state/store";
import { sceneOf } from "../document/time";
import type { Moving } from "../document/types";

/**
 * Marking a moment by hand. With Option held: P for position, S for size, T for opacity, R for turn.
 * It marks the value the selected things have at the playhead. After that, changing them at another
 * moment marks that moment too, and they move between the two. Pressed again on a mark, it takes it away.
 */
const MARKS: Record<string, Moving[]> = { KeyP: ["x", "y"], KeyS: ["width", "height"], KeyT: ["opacity"], KeyR: ["rotation"] };

let wired = false;
export function wireKeys() {
  if (wired) return;
  wired = true;
  window.addEventListener(
    "keydown",
    (e) => {
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
