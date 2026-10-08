import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { DesignFileError, parseDoc, serializeDoc } from "../document/serialize";
import { getState, loadDoc, loadTimeline, setEntryVersion, setProject, subscribe } from "../state/store";
import type { HistoryEntry } from "../state/store";

const FILE = "design.json";
const LAST_KEY = "duet:last-project";
const HISTORY_LIMIT = 300;

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

let lastSaved: Doc | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Run saves one after another, so two saves never overlap. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

const committed = () => {
  const s = getState();
  return s.timeline[s.cursor].doc;
};

function remember(path: string | null) {
  try {
    if (path) localStorage.setItem(LAST_KEY, path);
  } catch {
    /* private mode: nothing to remember */
  }
}

async function oops(text: string) {
  if (inTauri()) await message(text, { title: "Duet", kind: "error" });
  else console.error(text);
}

async function writeDesign(path: string, doc: Doc) {
  await invoke("write_text_file", { path: join(path, FILE), contents: serializeDoc(doc) });
}

/** The text stored with each saved step. The first line is what the history strip shows. */
function stepMessage(entry: HistoryEntry, wentBack: boolean) {
  const label = wentBack ? `Went back to: ${entry.label}` : entry.label;
  return `${label}\n\nActor: ${entry.actor}`;
}

/** Record the current design as a saved step. Never blocks or fails the save itself. */
async function recordStep(path: string, text: string) {
  try {
    await invoke("git_commit", { path, message: text });
  } catch (e) {
    console.warn("History could not record this step:", e);
  }
}

async function startHistory(path: string, label: string) {
  try {
    await invoke("git_prepare", { path });
    await invoke("git_commit", { path, message: `${label}\n\nActor: you` });
  } catch (e) {
    console.warn("History could not start:", e);
  }
}

/** Write the current design now, and keep a step in the history. */
export function saveNow(): Promise<void> {
  return enqueue(async () => {
    const s = getState();
    const path = s.project.path;
    if (!path) return saveAs();
    const doc = committed();
    const entry = s.timeline[s.cursor];
    const wentBack = s.cursor < s.timeline.length - 1;
    const previous = lastSaved;
    lastSaved = doc; // set first, so the store update below does not look like a new change
    setProject({ status: "saving", error: null });
    try {
      await writeDesign(path, doc);
      await recordStep(path, stepMessage(entry, wentBack));
      setProject({ status: committed() === doc ? "saved" : "unsaved" });
    } catch (e) {
      lastSaved = previous;
      setProject({ status: "error", error: String(e) });
    }
  });
}

/** Pick a folder for the current, unsaved work. */
export async function saveAs() {
  if (!inTauri()) return;
  const picked = await save({ title: "Save your project", defaultPath: "My design" });
  if (!picked) return;
  const doc = committed();
  try {
    if ((await invoke<boolean>("path_exists", { path: join(picked, FILE) })) === true) {
      await oops("That folder already has a design in it. Pick a new name, or use Open.");
      return;
    }
    await invoke("make_dir", { path: picked });
    await writeDesign(picked, doc);
    await startHistory(picked, "Start of project");
    lastSaved = doc;
    setProject({ path: picked, name: baseName(picked), status: "saved", error: null });
    remember(picked);
  } catch (e) {
    await oops(String(e));
  }
}

/** Start a new, empty project in a folder you choose. */
export async function newProject() {
  if (!inTauri()) return;
  const s = getState();
  if (!s.project.path && s.timeline.length > 1) {
    const go = await ask("Your current work has not been saved. Start a new project anyway?", {
      title: "Duet",
      kind: "warning",
      okLabel: "Start new",
      cancelLabel: "Cancel",
    });
    if (!go) return;
  }
  const picked = await save({ title: "Name your new project", defaultPath: "My design" });
  if (!picked) return;
  try {
    if ((await invoke<boolean>("path_exists", { path: join(picked, FILE) })) === true) {
      await oops("That folder already has a design in it. Pick a new name, or use Open.");
      return;
    }
    const doc = emptyDoc();
    await invoke("make_dir", { path: picked });
    await writeDesign(picked, doc);
    await startHistory(picked, "New file");
    loadDoc(doc, "New file");
    lastSaved = committed();
    setProject({ path: picked, name: baseName(picked), status: "saved", error: null });
    remember(picked);
  } catch (e) {
    await oops(String(e));
  }
}

interface HistoryItem {
  hash: string;
  time: number;
  label: string;
  actor: string;
  doc: string;
  versions: string[];
}

/** The saved steps of this project, oldest first. Empty if there is no history yet. */
async function readHistory(path: string): Promise<HistoryEntry[]> {
  try {
    const items = await invoke<HistoryItem[]>("git_history", { path, limit: HISTORY_LIMIT });
    const out: HistoryEntry[] = [];
    for (const i of items) {
      try {
        out.push({
          doc: parseDoc(i.doc),
          label: i.label,
          actor: i.actor === "ai" ? "ai" : "you",
          time: i.time * 1000,
          version: i.versions[0],
        });
      } catch {
        /* skip a step whose file we cannot read */
      }
    }
    return out;
  } catch (e) {
    console.warn("Could not read history:", e);
    return [];
  }
}

async function loadFrom(path: string, quiet = false): Promise<boolean> {
  try {
    const file = join(path, FILE);
    if (!((await invoke<boolean>("path_exists", { path: file })) === true)) {
      if (!quiet) await oops(`There is no ${FILE} in that folder. Use New to start a project there, or pick a different folder.`);
      return false;
    }
    const doc = parseDoc(await invoke<string>("read_text_file", { path: file }));
    const entries = await readHistory(path);
    if (entries.length === 0) {
      loadDoc(doc);
      await startHistory(path, "Start of project");
    } else {
      const last = entries[entries.length - 1];
      // The file on disk can be newer than the last saved step (edited elsewhere, or the app closed mid-save).
      if (serializeDoc(last.doc) !== serializeDoc(doc)) {
        entries.push({ doc, label: "Opened with newer changes", actor: "you", time: Date.now() });
      }
      loadTimeline(entries);
    }
    lastSaved = committed();
    setProject({ path, name: baseName(path), status: "saved", error: null });
    remember(path);
    return true;
  } catch (e) {
    if (!quiet) await oops(e instanceof DesignFileError ? e.message : String(e));
    return false;
  }
}

/** Choose a project folder and open it. */
export async function openProject() {
  if (!inTauri()) return;
  const picked = await open({ directory: true, multiple: false, title: "Open a Duet project folder" });
  if (typeof picked === "string") await loadFrom(picked);
}

/** On launch, go back to where you were. */
export async function restoreLast() {
  if (!inTauri()) return;
  let path: string | null = null;
  try {
    path = localStorage.getItem(LAST_KEY);
  } catch {
    path = null;
  }
  if (path) await loadFrom(path, true);
}

/**
 * Give the current moment a name. Returns a short message if it could not be done.
 * Underneath this is a tag on the saved step. The designer only sees a name.
 */
export async function saveVersion(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return "Give this version a name.";
  if (!inTauri()) return "Versions work in the desktop app.";
  const path = getState().project.path;
  if (!path) return "Save the project first, then name a version.";
  await saveNow();
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "version";
  try {
    await invoke("git_name_version", { path, tag: `v${Date.now()}-${slug}`, title: clean });
    setEntryVersion(getState().cursor, clean);
    return null;
  } catch (e) {
    return `Could not save the version: ${e}`;
  }
}

/** Save a moment after every change once the project has a home. */
export function startAutosave() {
  return subscribe(() => {
    const s = getState();
    if (!s.project.path) return;
    const doc = s.timeline[s.cursor].doc;
    if (doc === lastSaved) return;
    if (s.project.status !== "unsaved") setProject({ status: "unsaved" });
    clearTimeout(timer);
    timer = setTimeout(saveNow, 700);
  });
}
