import { invoke } from "@tauri-apps/api/core";

/** Where a project's memory lives inside its working folder. It is packed into the project file with everything else. */
const THREAD_FILE = "memory/thread.json";

const inside = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}/${name}`;

/** The text of a project's thread file, or null if it has none yet. */
export async function loadThread(dir: string): Promise<string | null> {
  try {
    const path = inside(dir, THREAD_FILE);
    if ((await invoke<boolean>("path_exists", { path })) !== true) return null;
    return await invoke<string>("read_text_file", { path });
  } catch {
    return null;
  }
}

export async function saveThread(dir: string, text: string): Promise<void> {
  await invoke("write_text_file", { path: inside(dir, THREAD_FILE), contents: text });
}
