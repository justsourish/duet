import { newStepId } from "../memory/steps";
import type { AbsNode } from "../document/path";
import { useSyncExternalStore } from "react";
import { commandLabel, runCommand } from "../commands";
import type { Actor, CommandName } from "../commands";
import { docAt } from "../document/time";
import { emptyDoc } from "../document/types";
import type { Doc, ElementType, Rect } from "../document/types";

export type Tool = "move" | "frame" | "rect" | "ellipse" | "text" | "hand" | "pen" | "zoom";

export interface HistoryEntry {
  doc: Doc;
  label: string;
  actor: Actor;
  /** Which AI tool made this step, when one did and said who it is. */
  by?: string;
  /** Milliseconds since 1970, when this step happened. */
  time: number;
  /** Set when this moment has been given a name, like "Client round 1". */
  version?: string;
  /** The step's own name, so what was said can point at it. */
  step?: string;
  /** Names of quick steps that were saved together with this one. */
  covers?: string[];
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
  /** The line being drawn with the pen, in page pixels, and where the pointer is. */
  pen: { nodes: AbsNode[]; cursor: { x: number; y: number } | null } | null;
  /** The line whose points are being edited, and which point is chosen. */
  nodeEdit: { id: string; selected: number | null } | null;
  /** The angle being shown while something is turned by hand, or null. */
  turning: number | null;
}

export interface Project {
  /** Folder that holds design.json (for a single file project, its unpacked working copy). Null while the work has not been saved anywhere. */
  path: string | null;
  /** The single .duet file this project is saved in. Null for an older folder project. */
  file: string | null;
  name: string;
  status: "unsaved" | "saving" | "saved" | "error";
  error: string | null;
}

/** Where in time the canvas is showing a frame that plays. */
export interface Clock {
  /** The frame being played, or null when the canvas shows the design as it is. */
  scene: string | null;
  /** Seconds from the start of that frame. */
  t: number;
  playing: boolean;
}

export interface State {
  project: Project;
  timeline: HistoryEntry[];
  cursor: number;
  /** Live preview while dragging. Not in history until committed. */
  transientDoc: Doc | null;
  selection: string[];
  tool: Tool;
  viewport: Viewport;
  overlay: Overlay;
  editingId: string | null;
  clock: Clock;
}

const noOverlay = (): Overlay => ({ draft: null, guidesX: [], guidesY: [], marquee: null, hoverId: null, pen: null, nodeEdit: null, turning: null });

const initial = (): State => ({
  project: { path: null, file: null, name: "Untitled", status: "unsaved", error: null },
  timeline: [{ doc: emptyDoc(), label: "New file", actor: "you", time: Date.now() }],
  cursor: 0,
  transientDoc: null,
  selection: [],
  tool: "move",
  viewport: { x: 160, y: 100, zoom: 1 },
  overlay: noOverlay(),
  editingId: null,
  clock: { scene: null, t: 0, playing: false },
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

let seen: { doc: Doc; scene: string; t: number; out: Doc } | null = null;

/** The design as the canvas shows it: at the moment the clock is on, when a frame that plays is open. */
export function seenDoc(s: State = state): Doc {
  const doc = currentDoc(s);
  const { scene, t } = s.clock;
  if (!scene || !doc.elements[scene]?.duration) return doc;
  if (!seen || seen.doc !== doc || seen.scene !== scene || seen.t !== t) seen = { doc, scene, t, out: docAt(doc, scene, t) };
  return seen.out;
}

/** Test helper: reset everything. */
export function resetStore() {
  state = initial();
  lastNudge = null;
  listeners.forEach((l) => l());
}

function cleanSelection(sel: string[], doc: Doc): string[] {
  return sel.filter((id) => doc.elements[id]);
}

function commit(doc: Doc, label: string, actor: Actor, by?: string) {
  const base = state.timeline[state.cursor].doc;
  if (doc === base) {
    set({ transientDoc: null });
    return;
  }
  const timeline = state.timeline.slice(0, state.cursor + 1).concat({ doc, label, actor, ...(by ? { by } : {}), time: Date.now(), step: newStepId() });
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
export function dispatch<N extends CommandName>(name: N, args: ArgsOf<N>, actor: Actor = "you", by?: string) {
  const doc = runCommand(currentDoc(), name, args);
  commit(doc, commandLabel(name, args), actor, by);
}

/** Arrow presses closer together than this count as one step. Shorter than the wait before saving. */
const NUDGE_GAP = 600;
let lastNudge: { entry: HistoryEntry; ids: string } | null = null;

/** Move with the arrow keys. Holding a key, or tapping quickly, is one step in history, not one per press. */
export function nudge(ids: string[], dx: number, dy: number) {
  const args = { ids, dx, dy };
  const doc = runCommand(currentDoc(), "move_elements", args);
  const here = state.timeline[state.cursor];
  const key = ids.join(",");
  const now = Date.now();
  const going = lastNudge && lastNudge.entry === here && lastNudge.ids === key && now - here.time < NUDGE_GAP;
  if (going && state.cursor > 0 && state.cursor === state.timeline.length - 1) {
    const entry = { ...here, doc, time: now };
    set({ timeline: state.timeline.slice(0, state.cursor).concat(entry), transientDoc: null });
  } else {
    commit(doc, commandLabel("move_elements", args), "you");
  }
  lastNudge = { entry: state.timeline[state.cursor], ids: key };
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

// ---- project ----

export const setProject = (patch: Partial<Project>) => set({ project: { ...state.project, ...patch } });

/** Replace everything with a freshly opened document. History starts over. */
export function loadDoc(doc: Doc, label = "Opened") {
  set({
    timeline: [{ doc, label, actor: "you", time: Date.now() }],
    cursor: 0,
    transientDoc: null,
    selection: [],
    editingId: null,
    overlay: noOverlay(),
    clock: { scene: null, t: 0, playing: false },
  });
}

/** Replace everything with a history that was saved earlier. Lands on the newest step. */
export function loadTimeline(entries: HistoryEntry[]) {
  set({
    timeline: entries,
    cursor: entries.length - 1,
    transientDoc: null,
    selection: [],
    editingId: null,
    overlay: noOverlay(),
    clock: { scene: null, t: 0, playing: false },
  });
}

/** Mark a step as a named version. */
export function setEntryVersion(index: number, name: string) {
  set({ timeline: state.timeline.map((e, i) => (i === index ? { ...e, version: name } : e)) });
}

/** Bring an old design back as a new step. Nothing is lost. */
export function restoreDoc(doc: Doc, label: string, actor: Actor = "you", by?: string) {
  commit(doc, label, actor, by);
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
export const setClock = (patch: Partial<Clock>) => set({ clock: { ...state.clock, ...patch } });
