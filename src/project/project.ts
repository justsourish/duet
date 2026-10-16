import { flushPictures, picturesIn, preloadPictures } from "./assets";
import { renderPng } from "./exporter";
import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { DesignFileError, parseDoc, serializeDoc } from "../document/serialize";
import { readyToLeave } from "../ai/agent";
import { conversationProject, getChat, moveConversationTo, restoreConversation, showConversationFor, subscribeChat } from "../ai/chat";
import { loadThread, saveThread } from "../memory/files";
import { stepsLine } from "../memory/steps";
import { keepable, packThread, readThread } from "../memory/thread";
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

/** True in Duet dev, a second Duet used only to check work on Duet itself. Set once at launch. */
let checkCopy = false;
export const isCheckCopy = () => checkCopy;

/** Find out, before anything is opened, whether this is Duet dev. */
export async function learnCheckCopy(): Promise<boolean> {
  checkCopy = inTauri() && (await invoke<boolean>("check_copy").catch(() => false));
  return checkCopy;
}

// ---- open projects, shown as tabs. Only one is loaded at a time; the others are one click away and keep their history ----
const TABS_KEY = "duet:tabs";
let tabs: string[] | null = null;

/** The projects you have open, in the order you opened them. */
export function getTabs(): string[] {
  if (tabs) return tabs;
  try {
    const raw = checkCopy ? [] : JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]");
    tabs = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && /\.duet$/i.test(p)) : [];
  } catch {
    tabs = [];
  }
  return tabs;
}

function setTabs(next: string[]) {
  tabs = next;
  try {
    // Duet dev shares this storage with the Duet a designer works in, and must leave it alone
    if (!checkCopy) localStorage.setItem(TABS_KEY, JSON.stringify(next));
  } catch {
    /* private mode: tabs last until Duet closes */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("duet:tabs"));
}

/** Put a project among the open ones. */
export function addTab(path: string) {
  if (!getTabs().includes(path)) setTabs([...getTabs(), path].slice(-12));
}

/** Take a project off the open ones. Returns the one to show next, if there is one. */
export function closeTab(path: string): string | null {
  const list = getTabs();
  const at = list.indexOf(path);
  const rest = list.filter((p) => p !== path);
  setTabs(rest);
  return rest[Math.min(at, rest.length - 1)] ?? null;
}

export const tabName = (path: string) => getRecents().find((r) => r.path === path)?.name ?? baseName(path);

function remember(path: string | null) {
  if (path) addTab(path);
  try {
    // Duet dev shares this list with the Duet a designer works in, and must leave it alone
    if (!path || checkCopy) return;
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

/** A small picture of the first screen, as PNG data. Null when there is nothing to show. */
async function previewPng(doc: Doc): Promise<string | null> {
  const id = doc.rootIds.find((i) => doc.elements[i]?.type === "frame" || doc.elements[i]?.type === "instance") ?? doc.rootIds[0];
  if (!id) return null;
  const el = doc.elements[id];
  await preloadPictures(doc);
  return renderPng(doc, id, Math.min(1, 360 / Math.max(el.width, el.height, 1)));
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
/** Drawing the preview takes a moment on a big design, so it waits until you pause, never during a save. */
function previewLater(path: string, doc: Doc) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const draw = () => void writePreview(path, doc);
    if (typeof requestIdleCallback === "function") requestIdleCallback(draw, { timeout: 4000 });
    else draw();
  }, 8000);
}

/** A small picture of the first screen, kept with the project in the list of projects. */
async function writePreview(path: string, doc: Doc) {
  try {
    const b64 = await previewPng(doc);
    if (!b64) return;
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
  await flushThread();
  if (packTimer) await packNow().catch(() => undefined);
}

// ---- the conversation is kept with the project ----

let threadTimer: ReturnType<typeof setTimeout> | undefined;
/** The working folder a conversation is waiting to be written to. */
let threadFor: string | null = null;
/** What was last read from or written to a project's thread file, so nothing is written twice. */
let threadKept: { dir: string; text: string } | null = null;

/** The conversation changed. Write it into the project a moment later. */
function threadChanged() {
  const { path, file } = getState().project;
  // while another project is being opened the chat and the project do not match yet
  if (!path || file !== conversationProject()) return;
  threadFor = path;
  clearTimeout(threadTimer);
  threadTimer = setTimeout(() => void flushThread(), 800);
}

/** Write the conversation now if a write is waiting. Always called before the chat moves to another project. */
async function flushThread() {
  clearTimeout(threadTimer);
  threadTimer = undefined;
  const dir = threadFor;
  threadFor = null;
  if (!dir || getState().project.path !== dir) return;
  const chat = getChat();
  // a project nobody has talked in gets no file
  if (!chat.messages.length && !chat.earlier.length && threadKept?.dir !== dir) return;
  const text = packThread({ now: keepable(chat.messages), earlier: keepable(chat.earlier) });
  if (threadKept?.dir === dir && threadKept.text === text) return;
  try {
    await saveThread(dir, text);
    threadKept = { dir, text };
    schedulePack();
  } catch (e) {
    console.warn("The conversation could not be saved:", e);
  }
}

/** A project has just been opened. If Duet has nothing of its conversation, bring back what was saved with it. */
async function bringBackThread(dir: string) {
  if (getChat().messages.length || getChat().earlier.length) return;
  const text = await loadThread(dir);
  const thread = readThread(text);
  threadKept = text === null ? null : { dir, text: packThread(thread) };
  restoreConversation(thread.now, thread.earlier);
}

async function writeDesign(path: string, doc: Doc) {
  await flushPictures(path, doc);
  await invoke("write_text_file", { path: join(path, FILE), contents: serializeDoc(doc) });
  previewLater(path, doc);
}

/** The text stored with each saved step. The first line is what the history strip shows. */
export function stepMessage(entry: Pick<HistoryEntry, "label" | "actor" | "by">, wentBack: boolean, names: string[] = []) {
  const label = wentBack ? `Went back to: ${entry.label}` : entry.label;
  const steps = stepsLine(names);
  // one line, so a name can never start a line of its own meaning
  const by = entry.actor === "ai" && entry.by ? `\nBy: ${entry.by.replace(/\s+/g, " ").trim()}` : "";
  return `${label}\n\nActor: ${entry.actor}${by}${steps ? `\n${steps}` : ""}`;
}

/** Names of steps that are already kept in a saved step of the open project. */
let stepsKept = new Set<string>();

/** The names of the steps up to here that no saved step holds yet, oldest first, so this one's own name comes last. */
export function stepsToKeep(timeline: Pick<HistoryEntry, "step">[], cursor: number, kept: Set<string>): string[] {
  return timeline.slice(0, cursor + 1).flatMap((e) => (e.step && !kept.has(e.step) ? [e.step] : []));
}

/** Record the current design as a saved step. Never blocks or fails the save itself. Says whether a step was made. */
async function recordStep(path: string, text: string): Promise<boolean> {
  try {
    return (await invoke<boolean>("git_commit", { path, message: text })) === true;
  } catch (e) {
    console.warn("History could not record this step:", e);
    return false;
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
      const names = stepsToKeep(s.timeline, s.cursor, stepsKept);
      if (await recordStep(path, stepMessage(entry, wentBack, names))) for (const n of names) stepsKept.add(n);
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
  stepsKept = new Set();
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
    moveConversationTo(picked);
    threadChanged();
    await flushThread();
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
  if (!(await readyToLeave())) return;
  try {
    const doc = emptyDoc();
    await flushPack(); // what was said in the project being left goes into its file first
    const work = await createProject(picked, doc, "New file");
    showConversationFor(picked, true);
    loadDoc(doc, "New file");
    lastSaved = committed();
    setProject({ path: work, file: picked, name: baseName(picked), status: "saved", error: null });
    await packNow();
    remember(picked);
  } catch (e) {
    await oops(String(e));
  }
}

// ---- a test design, for building Duet ----

const TEST_NAME = "Test design";
/** The project being opened right now, if any. */
let opening: Promise<unknown> = Promise.resolve();
/** The project file that was put away when a test design started. */
let leftForTest: string | null = null;
let inTest = false;

export const inTestDesign = () => inTest;

/**
 * Put the open project away and start a design that has no file, so nothing a test does is saved anywhere.
 * Returns a short message if it could not be done.
 */
export async function startTestDesign(doc: Doc = emptyDoc()): Promise<string | null> {
  // a project still being opened, such as the last one at launch, would land on top of the test design
  await opening.catch(() => undefined);
  const s = getState();
  if (!inTest) {
    if (!s.project.path && s.timeline.length > 1) return "There is work here that has not been saved. Save it first.";
    // no question on the screen here: whoever asked for a test design cannot answer one
    if (getChat().running) return "The AI in the chat is still working. Wait for it or stop it first.";
    clearTimeout(timer);
    // a change still waiting to be saved belongs to the project being put away
    if (s.project.path && committed() !== lastSaved) await saveNow();
    await flushPack();
    leftForTest = s.project.file;
  }
  inTest = true;
  showConversationFor(TEST_NAME, true);
  // the project lets go first, so the test design is never taken for a change to it
  setProject({ path: null, file: null, name: TEST_NAME, status: "unsaved", error: null });
  loadDoc(doc, TEST_NAME);
  lastSaved = committed();
  clearTimeout(timer);
  return null;
}

/**
 * Keep the test design as a project file, with no window to ask where. For mockups drawn in Duet dev.
 * The file must end in .duet and must not be there yet. Returns a short message if it could not be done.
 */
export async function keepTestDesign(file: string): Promise<string | null> {
  if (!inTest) return "There is no test design open.";
  if (!inTauri()) return "Saving works in the desktop app.";
  if (!file.toLowerCase().endsWith(".duet")) return "The file name must end in .duet.";
  if ((await invoke<boolean>("path_exists", { path: file })) === true) return "There is already a file with that name. Pick another name.";
  const doc = committed();
  try {
    const work = await createProject(file, doc, "Start of project");
    lastSaved = doc;
    inTest = false;
    setProject({ path: work, file, name: baseName(file), status: "saved", error: null });
    await packNow();
    void writePreview(work, doc);
    return null;
  } catch (e) {
    return String(e);
  }
}

/** Close the project on screen and leave an empty, unsaved one behind it. Used when the last tab is closed. */
export async function closeProject() {
  await flushPack(); // what was said in the project being left goes into its file first
  showConversationFor("", true);
  setProject({ path: null, file: null, name: "Untitled", status: "unsaved", error: null });
  loadDoc(emptyDoc(), "New file");
  lastSaved = committed();
  clearTimeout(timer);
}

/** Throw the test design away and bring back the project that was open before it. */
export async function leaveTestDesign(): Promise<string | null> {
  // after a test design was kept as a file there is still a project to go back to
  if (!inTest && !leftForTest && !checkCopy) return "There is no test design open.";
  inTest = false;
  await flushPack();
  const back = leftForTest;
  leftForTest = null;
  setProject({ path: null, file: null, name: "Untitled", status: "unsaved", error: null });
  loadDoc(emptyDoc(), "New file");
  lastSaved = committed();
  clearTimeout(timer);
  if (back && inTauri() && !(await openAny(back, true))) return `The project at ${back} could not be opened again.`;
  return null;
}

interface HistoryItem {
  hash: string;
  time: number;
  label: string;
  actor: string;
  by?: string | null;
  doc: string;
  versions: string[];
  steps?: string[];
}

/** The saved steps of this project, oldest first. Empty if there is no history yet. */
async function readHistory(path: string): Promise<HistoryEntry[]> {
  try {
    const items = await invoke<HistoryItem[]>("git_history", { path, limit: HISTORY_LIMIT });
    const out: HistoryEntry[] = [];
    for (const i of items) {
      try {
        const names = i.steps ?? [];
        out.push({
          doc: parseDoc(i.doc),
          label: i.label,
          actor: i.actor === "ai" ? "ai" : "you",
          ...(i.actor === "ai" && i.by ? { by: i.by } : {}),
          time: i.time * 1000,
          version: i.versions[0],
          // a step saved before steps had names is known by what its saved step is called
          step: names.length ? names[names.length - 1] : i.hash,
          covers: names.length > 1 ? names.slice(0, -1) : undefined,
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
    stepsKept = new Set(entries.flatMap((e) => [e.step, ...(e.covers ?? [])].filter((n): n is string => !!n)));
    await flushPack(); // what was said in the project being left goes into its file first
    showConversationFor(file);
    await bringBackThread(path);
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

/**
 * Open a project you already know the folder of, such as one from the projects list. `closing` is set
 * when it opens because the tab before it was closed, so the questions speak of closing.
 */
export async function openProjectAt(path: string, closing = false): Promise<boolean> {
  if (!inTauri()) return false;
  const s = getState();
  if (!s.project.path && s.timeline.length > 1) {
    const go = await ask(closing ? "Your current work has not been saved. Close it anyway?" : "Your current work has not been saved. Open another project anyway?", {
      title: "Duet",
      kind: "warning",
      okLabel: closing ? "Close" : "Open",
      cancelLabel: closing ? "Keep working" : "Cancel",
    });
    if (!go) return false;
  }
  if (!(await readyToLeave(closing))) return false;
  return openAny(path);
}

/** Open a project file. */
function openAny(path: string, quiet = false): Promise<boolean> {
  const job = openFile(path, quiet);
  opening = job;
  return job;
}

async function openFile(path: string, quiet: boolean): Promise<boolean> {
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
  if (typeof picked === "string" && (await readyToLeave())) await openAny(picked);
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

/** What a copy carries besides the design as it is now. Both are left out unless asked for. */
export interface CopyChoice {
  /** The earlier steps and the named versions. */
  history: boolean;
  /** The conversation with the AI. */
  conversation: boolean;
}

/** The name a copy starts with: the project's own name with "copy" after it, in the same folder. */
export function copyNameFor(file: string): string {
  return file.replace(/(\.duet)?$/i, " copy.duet");
}

/**
 * Save a second project file to hand to someone else. The project you are working in is not changed
 * and stays open. Returns where the copy went, why it could not be made, or null if you backed out.
 */
export async function sendCopy(choice: CopyChoice): Promise<{ saved: string } | { why: string } | null> {
  if (!inTauri()) return { why: "Sending a copy works in the desktop app." };
  const result = await once(() => sendCopyDialog(choice));
  return result ?? null;
}

async function sendCopyDialog(choice: CopyChoice): Promise<{ saved: string } | { why: string } | null> {
  const { path, file } = getState().project;
  if (!path || !file) return { why: "Save your project first, then send a copy." };
  const target = await save({ title: "Send a copy", defaultPath: copyNameFor(file), filters: [{ name: "Duet project", extensions: ["duet"] }] });
  if (!target) return null;
  const picked = withExt(target);
  if (picked === file) return { why: "That is the project you are working in. Give the copy a different name." };
  if ((await invoke<boolean>("is_directory", { path: picked })) === true) return { why: "There is an older project folder with that name. Pick a different name." };
  // everything on the canvas is written into the working folder first, so the copy is made from what you see
  await saveNow();
  return enqueue(async () => {
    if (getState().project.path !== path) return { why: "Another project was opened. Send the copy again." };
    try {
      if (choice.conversation) await flushThread();
      const doc = committed();
      await flushPictures(path, doc);
      await invoke("pack_copy", {
        dir: path,
        file: picked,
        design: serializeDoc(doc),
        previewBase64: await previewPng(doc).catch(() => null),
        pictures: picturesIn(doc),
        history: choice.history,
        conversation: choice.conversation,
      });
      return { saved: picked };
    } catch (e) {
      return { why: String(e) };
    }
  });
}

/** On launch, go back to where you were. */
export async function restoreLast() {
  if (!inTauri()) return;
  // Duet dev never opens a designer's project by itself: two Duets on one project would fight over it
  if (await learnCheckCopy()) return;
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
  const stopThread = subscribeChat(threadChanged);
  const stopDesign = subscribe(() => {
    const s = getState();
    if (!s.project.path) return;
    const doc = s.timeline[s.cursor].doc;
    if (doc === lastSaved) return;
    if (s.project.status !== "unsaved") setProject({ status: "unsaved" });
    clearTimeout(timer);
    timer = setTimeout(saveNow, 700);
  });
  return () => {
    stopThread();
    stopDesign();
  };
}
