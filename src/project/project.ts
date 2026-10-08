import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { DesignFileError, parseDoc, serializeDoc } from "../document/serialize";
import { getState, loadDoc, setProject, subscribe } from "../state/store";

const FILE = "design.json";
const LAST_KEY = "duet:last-project";

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

let lastSaved: Doc | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

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

/** Write the current design now. */
export async function saveNow() {
  const s = getState();
  const path = s.project.path;
  if (!path) return saveAs();
  const doc = committed();
  const previous = lastSaved;
  lastSaved = doc; // set first, so the store update below does not look like a new change
  setProject({ status: "saving", error: null });
  try {
    await writeDesign(path, doc);
    if (committed() === doc) setProject({ status: "saved" });
    else setProject({ status: "unsaved" });
  } catch (e) {
    lastSaved = previous;
    setProject({ status: "error", error: String(e) });
  }
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
    loadDoc(doc, "New file");
    lastSaved = committed();
    setProject({ path: picked, name: baseName(picked), status: "saved", error: null });
    remember(picked);
  } catch (e) {
    await oops(String(e));
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
    loadDoc(doc);
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
