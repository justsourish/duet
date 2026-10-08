import { useSyncExternalStore } from "react";
import { commandLabel, runCommand } from "../commands";
import type { Actor, CommandName } from "../commands";
import { emptyDoc } from "../document/types";
import type { Doc, ElementType, Rect } from "../document/types";

export type Tool = "move" | "frame" | "rect" | "ellipse" | "text" | "hand";

export interface HistoryEntry {
  doc: Doc;
  label: string;
  actor: Actor;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Overlay {
  draft: { type: ElementType; rect: Rect } | null;
  guidesX: number[];
  guidesY: number[];
  marquee: Rect | null;
  hoverId: string | null;
}

export interface State {
  timeline: HistoryEntry[];
  cursor: number;
  /** Live preview while dragging. Not in history until committed. */
  transientDoc: Doc | null;
  selection: string[];
  tool: Tool;
  viewport: Viewport;
  overlay: Overlay;
  editingId: string | null;
}

const noOverlay = (): Overlay => ({ draft: null, guidesX: [], guidesY: [], marquee: null, hoverId: null });

const initial = (): State => ({
  timeline: [{ doc: emptyDoc(), label: "New file", actor: "you" }],
  cursor: 0,
  transientDoc: null,
  selection: [],
  tool: "move",
  viewport: { x: 160, y: 100, zoom: 1 },
  overlay: noOverlay(),
  editingId: null,
});

let state: State = initial();
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getState = (): State => state;

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export const currentDoc = (s: State = state): Doc => s.transientDoc ?? s.timeline[s.cursor].doc;

/** Test helper: reset everything. */
export function resetStore() {
  state = initial();
  listeners.forEach((l) => l());
}

function cleanSelection(sel: string[], doc: Doc): string[] {
  return sel.filter((id) => doc.elements[id]);
}

function commit(doc: Doc, label: string, actor: Actor) {
  const base = state.timeline[state.cursor].doc;
  if (doc === base) {
    set({ transientDoc: null });
    return;
  }
  const timeline = state.timeline.slice(0, state.cursor + 1).concat({ doc, label, actor });
  set({
    timeline,
    cursor: timeline.length - 1,
    transientDoc: null,
    selection: cleanSelection(state.selection, doc),
  });
}

// ---- commands ----

type ArgsOf<N extends CommandName> = Parameters<typeof runCommand<N>>[2];

/** Run a command and record it as one step in history. */
export function dispatch<N extends CommandName>(name: N, args: ArgsOf<N>, actor: Actor = "you") {
  const doc = runCommand(currentDoc(), name, args);
  commit(doc, commandLabel(name, args), actor);
}

// ---- drags: preview without history, commit once at the end ----

export function dragBase(): Doc {
  return state.timeline[state.cursor].doc;
}

export function dragPreview<N extends CommandName>(name: N, args: ArgsOf<N>) {
  set({ transientDoc: runCommand(dragBase(), name, args) });
}

export function dragPreviewDoc(doc: Doc) {
  set({ transientDoc: doc });
}

export function dragCommit(label: string, actor: Actor = "you") {
  if (state.transientDoc) commit(state.transientDoc, label, actor);
}

export function dragCancel() {
  set({ transientDoc: null });
}

// ---- history ----

export function goTo(index: number) {
  const i = Math.max(0, Math.min(state.timeline.length - 1, index));
  const doc = state.timeline[i].doc;
  set({ cursor: i, transientDoc: null, selection: cleanSelection(state.selection, doc), editingId: null });
}

export const undo = () => goTo(state.cursor - 1);
export const redo = () => goTo(state.cursor + 1);

// ---- ui state ----

export const select = (ids: string[]) => set({ selection: ids });
export const setTool = (tool: Tool) => set({ tool });
export const setViewport = (viewport: Viewport) => set({ viewport });
export const setOverlay = (patch: Partial<Overlay>) => set({ overlay: { ...state.overlay, ...patch } });
export const clearOverlay = () => set({ overlay: noOverlay() });
export const setEditing = (id: string | null) => set({ editingId: id });
