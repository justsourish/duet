import { pastePayload } from "../canvas/CanvasView";
import { newId } from "../commands";
import { extractPayload } from "../document/clipboard";
import { defaultLayout } from "../document/layout";
import { currentDoc, dispatch, getState, select } from "../state/store";

/** Things you can do with the selection. The menus, the right-click menu and the panel all use these. */

const picked = () => {
  const doc = currentDoc();
  return { doc, els: getState().selection.map((i) => doc.elements[i]).filter(Boolean) };
};

export function duplicateSelection() {
  const { doc, els } = picked();
  const p = extractPayload(doc, els.map((e) => e.id));
  if (p) pastePayload(p, true);
}

export function groupSelection() {
  const { els } = picked();
  if (!els.length) return;
  const id = newId("group");
  dispatch("group_elements", { ids: els.map((e) => e.id), groupId: id });
  if (currentDoc().elements[id]) select([id]);
}

export function ungroupSelection() {
  const { els } = picked();
  const kids = els.flatMap((e) => (e.type === "group" ? e.childIds : []));
  if (!kids.length) return;
  dispatch("ungroup", { ids: els.map((e) => e.id) });
  select(kids);
}

export function makeComponent() {
  for (const e of picked().els) if ((e.type === "frame" || e.type === "group") && !e.component && !e.id.includes("::")) dispatch("create_component", { id: e.id });
}

export function detachSelection() {
  for (const e of picked().els) if (e.type === "instance") dispatch("detach_instance", { id: e.id });
}

export function toggleLock() {
  const { els } = picked();
  if (!els.length) return;
  const lock = !els.every((e) => e.locked);
  dispatch("set_props", { ids: els.map((e) => e.id), props: { locked: lock }, label: lock ? "Lock" : "Unlock" });
}

export function toggleAutoLayout() {
  const { els } = picked();
  if (!els.length) return;
  if (els.length === 1 && els[0].type === "frame") {
    dispatch("set_layout", { id: els[0].id, layout: els[0].layout ? null : defaultLayout() });
    return;
  }
  const id = newId("frame");
  dispatch("wrap_in_layout", { ids: els.map((e) => e.id), frameId: id });
  if (currentDoc().elements[id]) select([id]);
}

export function deleteSelection() {
  const { els } = picked();
  if (!els.length) return;
  dispatch("delete_elements", { ids: els.map((e) => e.id) });
  select([]);
}
