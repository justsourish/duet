import { flushPictures, preloadPictures } from "./assets";
import { renderPng } from "./exporter";
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
const baseName = (p: string) => (p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p).replace(/\.duet$/i, "");
/** A project is a folder whose name ends in .duet. Add the ending if it was left off. */
const withExt = (p: string) => (/\.duet$/i.test(p) ? p : `${p}.duet`);

let lastSaved: Doc | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Where the save window starts: the Duet folder in Documents, so projects end up in one place. */
async function startFolder(name: string): Promise<string> {
  try {
    return join(await invoke<string>("default_projects_dir"), name);
  } catch {
    return name;
  }
}

/** Look through a folder for Duet projects and add them to the list. Returns how many were found. */
export async function findProjects(root: string): Promise<number> {
  const found = await invoke<{ path: string; modified: number }[]>("find_projects", { root });
  const known = new Set(getRecents().map((r) => r.path));
  const add = found.filter((f) => !known.has(f.path));
  if (add.length) {
    const all = [...getRecents(), ...add.map((f) => ({ path: f.path, name: baseName(f.path), opened: f.modified }))];
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(all.sort((a, b) => b.opened - a.opened).slice(0, 200)));
    } catch {
      /* nothing to do */
    }
    window.dispatchEvent(new Event("duet:recents"));
  }
  return add.length;
}

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

const RECENT_KEY = "duet:recent";

export interface Recent {
  path: string;
  name: string;
  /** A small picture of the first screen, as a data address. */
  thumb?: string;
  /** When it was last opened, as milliseconds. */
  opened: number;
}

/** Every project you have made or opened here, newest first. */
export function getRecents(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: Recent[] = [];
    for (const r of raw) {
      if (!r || typeof r.path !== "string") continue;
      // only single .duet files are projects now
      if (!/\.duet$/i.test(r.path) || seen.has(r.path)) continue;
      seen.add(r.path);
      out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

export function removeRecent(path: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecents().filter((r) => r.path !== path)));
  } catch {
    /* nothing to do */
  }
  window.dispatchEvent(new Event("duet:recents"));
}

function remember(path: string | null) {
  try {
    if (!path) return;
    localStorage.setItem(LAST_KEY, path);
    const old = getRecents().find((r) => r.path === path);
    const rest = getRecents().filter((r) => r.path !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ path, name: baseName(path), opened: Date.now(), thumb: old?.thumb }, ...rest].slice(0, 40)));
    window.dispatchEvent(new Event("duet:recents"));
  } catch {
    /* private mode: nothing to remember */
  }
}

async function oops(text: string) {
  if (inTauri()) await message(text, { title: "Duet", kind: "error" });
  else console.error(text);
}

/** A small picture of the first screen, kept with the project in the list of projects. */
async function writePreview(path: string, doc: Doc) {
  try {
    const id = doc.rootIds.find((i) => doc.elements[i]?.type === "frame" || doc.elements[i]?.type === "instance") ?? doc.rootIds[0];
    if (!id) return;
    const el = doc.elements[id];
    await preloadPictures(doc);
    const scale = Math.min(1, 360 / Math.max(el.width, el.height, 1));
    const b64 = renderPng(doc, id, scale);
    await invoke("write_binary_file", { path: join(path, "preview.png"), dataBase64: b64 });
    const key = getState().project.file ?? path;
    const list = getRecents().map((r) => (r.path === key ? { ...r, thumb: `data:image/png;base64,${b64}` } : r));
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("duet:recents"));
  } catch (e) {
    console.warn("Could not make a preview:", e);
  }
}

// ---- one file: the project is packed into its .duet file after every save ----
let packTimer: ReturnType<typeof setTimeout> | undefined;

async function packNow() {
  clearTimeout(packTimer);
  packTimer = undefined;
  const { path, file } = getState().project;
  if (!path || !file) return;
  await invoke("pack_project", { dir: path, file });
}

function schedulePack() {
  if (!getState().project.file) return;
  clearTimeout(packTimer);
  packTimer = setTimeout(() => void packNow().catch((e) => setProject({ status: "error", error: String(e) })), 1200);
}

/** Write the file right now if a write is waiting. Used when the window closes. */
export async function flushPack() {
  if (packTimer) await packNow().catch(() => undefined);
}

async function writeDesign(path: string, doc: Doc) {
  await flushPictures(path, doc);
  await invoke("write_text_file", { path: join(path, FILE), contents: serializeDoc(doc) });
  void writePreview(path, doc);
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
      schedulePack();
      setProject({ status: committed() === doc ? "saved" : "unsaved" });
    } catch (e) {
      lastSaved = previous;
      setProject({ status: "error", error: String(e) });
    }
  });
}

/** Pick a folder for the current, unsaved work. */
let dialogOpen = false;
/** Run a dialog job once at a time, so a shortcut and its menu item cannot open it twice. */
async function once<T>(job: () => Promise<T>): Promise<T | undefined> {
  if (dialogOpen) return undefined;
  dialogOpen = true;
  try {
    return await job();
  } finally {
    dialogOpen = false;
  }
}

export async function saveAs() {
  await once(saveAsDialog);
}

/** Ask where to keep a project file. Returns the chosen path, or null. */
async function chooseFile(title: string): Promise<string | null> {
  const choice = await save({ title, defaultPath: await startFolder("My design.duet"), filters: [{ name: "Duet project", extensions: ["duet"] }] });
  if (!choice) return null;
  const picked = withExt(choice);
  if ((await invoke<boolean>("is_directory", { path: picked })) === true) {
    await oops("There is an older project folder with that name. Pick a different name.");
    return null;
  }
  return picked;
}

/** Make the project file and its working copy from a design. */
async function createProject(picked: string, doc: Doc, label: string) {
  const work = await invoke<string>("fresh_work_dir", { file: picked });
  await writeDesign(work, doc);
  await startHistory(work, label);
  return work;
}

async function saveAsDialog() {
  if (!inTauri()) return;
  const picked = await chooseFile("Save your project");
  if (!picked) return;
  const doc = committed();
  try {
    const work = await createProject(picked, doc, "Start of project");
    lastSaved = doc;
    setProject({ path: work, file: picked, name: baseName(picked), status: "saved", error: null });
    await packNow();
    remember(picked);
    void writePreview(work, doc);
  } catch (e) {
    await oops(String(e));
  }
}

/** Start a new, empty project in a folder you choose. */
export async function newProject() {
  await once(newProjectDialog);
}

async function newProjectDialog() {
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
  const picked = await chooseFile("Name your new project");
  if (!picked) return;
  try {
    const doc = emptyDoc();
    const work = await createProject(picked, doc, "New file");
    loadDoc(doc, "New file");
    lastSaved = committed();
    setProject({ path: work, file: picked, name: baseName(picked), status: "saved", error: null });
    await packNow();
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

async function loadFrom(path: string, quiet: boolean, file: string): Promise<boolean> {
  try {
    const design = join(path, FILE);
    if (!((await invoke<boolean>("path_exists", { path: design })) === true)) {
      if (!quiet) await oops(`There is no ${FILE} in that folder. Use New to start a project there, or pick a different folder.`);
      return false;
    }
    const doc = parseDoc(await invoke<string>("read_text_file", { path: design }));
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
    setProject({ path, file, name: baseName(file), status: "saved", error: null });
    remember(file);
    void writePreview(path, committed()); // older projects get their picture the first time they are opened
    return true;
  } catch (e) {
    if (!quiet) await oops(e instanceof DesignFileError ? e.message : String(e));
    return false;
  }
}

/** Open a project you already know the folder of, such as one from the projects list. */
export async function openProjectAt(path: string): Promise<boolean> {
  if (!inTauri()) return false;
  const s = getState();
  if (!s.project.path && s.timeline.length > 1) {
    const go = await ask("Your current work has not been saved. Open another project anyway?", {
      title: "Duet",
      kind: "warning",
      okLabel: "Open",
      cancelLabel: "Cancel",
    });
    if (!go) return false;
  }
  return openAny(path);
}

/** Open a project file. */
async function openAny(path: string, quiet = false): Promise<boolean> {
  try {
    if ((await invoke<boolean>("is_directory", { path })) === true) {
      if (!quiet) await oops("Duet projects are single .duet files now. Choose a file that ends in .duet.");
      return false;
    }
    if ((await invoke<boolean>("path_exists", { path })) !== true) {
      if (!quiet) await oops("That project was moved or deleted.");
      return false;
    }
    const work = await invoke<string>("unpack_project", { file: path });
    return loadFrom(work, quiet, path);
  } catch (e) {
    if (!quiet) await oops(String(e));
    return false;
  }
}

/** Choose a project file and open it. */
export async function openProject() {
  await once(openProjectDialog);
}

async function openProjectDialog() {
  if (!inTauri()) return;
  const picked = await open({ directory: false, multiple: false, title: "Open a Duet project", filters: [{ name: "Duet project", extensions: ["duet"] }] });
  if (typeof picked === "string") await openAny(picked);
}

/** Save the design as plain data (a .json file), for people and programs that want it. */
export async function exportDesignData() {
  if (!inTauri()) return;
  const name = getState().project.name || "design";
  const target = await save({ title: "Export the design data", defaultPath: `${name}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!target) return;
  try {
    await invoke("write_text_file", { path: target, contents: serializeDoc(committed()) });
  } catch (e) {
    await oops(String(e));
  }
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
  if (path) await openAny(path, true);
}

/**
 * Give the current moment a name. Returns a short message if it could not be done.
 * Underneath this is a tag on the saved step. The designer only sees a name.
 */
export async function saveVersion(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return "Give this version a name.";
  if (!inTauri()) return "Versions work in the desktop app.";
  let path = getState().project.path;
  if (!path) {
    // A version needs a home, so ask where the project should live, then carry on.
    await saveAs();
    path = getState().project.path;
    if (!path) return "Choose a folder for your project, then save the version again.";
  }
  await saveNow();
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "version";
  try {
    await invoke("git_name_version", { path, tag: `v${Date.now()}-${slug}`, title: clean });
    schedulePack();
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
