import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import CanvasView from "../canvas/CanvasView";
import type { Recent } from "../project/project";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Trashed } from "../project/project";
import { closeProject, closeTab, getRecents, getTabs, inTauri, newProject, openProjectAt, removeRecent, TRASH_DAYS, trashDelete, trashList, trashProject, trashRestore } from "../project/project";
import { getState, setViewport, useStore } from "../state/store";
import { readyToLeave } from "../ai/agent";
import ChatPanel from "./ChatPanel";
import Icon from "./Icons";
import SkillsPanel from "./SkillsPanel";

/** How long ago, in plain words. */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const previews = new Map<string, string | null>();

/** The small picture saved with a project, if there is one. */
function usePreview(path: string): string | null {
  const [src, setSrc] = useState<string | null>(previews.get(path) ?? null);
  useEffect(() => {
    if (!path || !inTauri() || previews.has(path)) return;
    let alive = true;
    invoke<string>("read_binary_file", { path: `${path}/preview.png` })
      .then((b64) => {
        previews.set(path, `data:image/png;base64,${b64}`);
        if (alive) setSrc(previews.get(path) ?? null);
      })
      .catch(() => previews.set(path, null));
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}

/** Projects that match what was typed, newest first as they are kept. */
export function matchProjects<T extends { name: string }>(all: T[], typed: string): T[] {
  const t = typed.trim().toLowerCase();
  return t ? all.filter((r) => r.name.toLowerCase().includes(t)) : all;
}

/** One project in the list: its picture, its name and when it was last opened. A dot says it is open. */
function ProjectRow({ r, on, open, onOpen, onMenu }: { r: Recent; on: boolean; open: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const own = usePreview(r.thumb ? "" : r.path);
  const src = r.thumb ?? own;
  return (
    <div
      className={`chathome-row ${on ? "on" : ""}`}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={r.path}
    >
      <div className="chathome-thumb">{src ? <img src={src} alt="" /> : null}</div>
      <div className="chathome-meta">
        <div className="chathome-name">{r.name}</div>
        <div className="chathome-when">{on ? "Open now" : open ? "Open" : ago(r.opened)}</div>
      </div>
      {open && !on && <span className="chathome-dot" title="Open" />}
    </div>
  );
}

/** What is in the trash: each can be put back, or deleted for good. */
function TrashView({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Trashed[] | null>(null);
  const load = () => void trashList().then(setItems);
  useEffect(load, []);
  const left = (t: Trashed) => Math.max(1, Math.ceil(TRASH_DAYS - (Date.now() - t.trashed) / 86400000));
  return (
    <div className="chathome-skills">
      <div className="chathome-skills-head">
        <b>Trash</b>
        <button className="pill" onClick={onBack}>
          Back to chat
        </button>
      </div>
      <div className="trash-note">Projects stay here for {TRASH_DAYS} days, then they are cleared out.</div>
      <div className="trash-list">
        {items?.map((t) => (
          <div className="trash-row" key={t.id}>
            <div className="chathome-meta">
              <div className="chathome-name">{t.name}</div>
              <div className="chathome-when">
                {left(t)} {left(t) === 1 ? "day" : "days"} left
              </div>
            </div>
            <button
              className="pill"
              onClick={() =>
                void trashRestore(t.id)
                  .then(load)
                  .catch(() => undefined)
              }
            >
              <Icon name="restore" size={14} /> Put back
            </button>
            <button
              className="pill"
              onClick={async () => {
                if (!(await ask(`Delete “${t.name}” for good? It cannot be brought back.`, { title: "Duet", kind: "warning", okLabel: "Delete", cancelLabel: "Keep it" }))) return;
                await trashDelete(t.id).catch(() => undefined);
                load();
              }}
            >
              Delete now
            </button>
          </div>
        ))}
        {items && items.length === 0 && <div className="chathome-none">The trash is empty.</div>}
      </div>
    </div>
  );
}

/**
 * Chat: your projects down the left, the chat of the project you picked in the middle, and its
 * canvas on the right to watch. The canvas here only looks; changing it is for Edit.
 */
export default function ChatHome({ onEdit }: { onEdit: () => void }) {
  const current = useStore((s) => s.project);
  // read again whenever the open project changes, since opening one moves it to the top of the list
  const recents = useMemo(() => getRecents(), [current.file, current.name]);
  const [typed, setTyped] = useState("");
  const [, again] = useState(0);
  useEffect(() => {
    const redo = () => again((n) => n + 1);
    window.addEventListener("duet:tabs", redo);
    return () => window.removeEventListener("duet:tabs", redo);
  }, []);
  const tabs = getTabs();
  const [skills, setSkills] = useState(false);
  const [trash, setTrash] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; r: Recent } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);
  // the canvas shows the whole design here, and the view goes back to where it was when you return to Edit
  useEffect(() => {
    const before = getState().viewport;
    const fit = setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 120);
    return () => {
      clearTimeout(fit);
      setViewport(before);
    };
  }, [current.file]);
  const shown = matchProjects(recents, typed);

  /** Close a project: its tab goes, and if it was on screen the next one comes up, or none. */
  const leave = async (path: string) => {
    if (!(await readyToLeave(true, path))) return false;
    const next = path === current.file ? getTabs().filter((p) => p !== path).pop() : null;
    closeTab(path);
    if (path === current.file) {
      if (next) await openProjectAt(next, true);
      else await closeProject();
    }
    return true;
  };

  return (
    <div className="chathome">
      <aside className="chathome-projects">
        <div className="chathome-nav">
          <button className="chathome-item" onClick={() => void newProject()} disabled={!inTauri()}>
            <Icon name="new-chat" size={16} /> New project
          </button>
          <label className="chathome-item chathome-search">
            <Icon name="search" size={16} />
            <input placeholder="Search projects" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <button className={`chathome-item ${skills ? "on" : ""}`} onClick={() => {
              setSkills(!skills);
              setTrash(false);
            }}>
            <Icon name="skills" size={16} /> Skills
          </button>
          <button
            className={`chathome-item ${trash ? "on" : ""}`}
            onClick={() => {
              setTrash(!trash);
              setSkills(false);
            }}
          >
            <Icon name="trash" size={16} /> Trash
          </button>
          <button className="chathome-item" onClick={() => window.dispatchEvent(new Event("duet:settings"))}>
            <Icon name="settings" size={16} /> Settings
          </button>
        </div>
        <div className="chathome-label">Projects</div>
        <div className="chathome-list">
          {shown.map((r) => (
            <ProjectRow key={r.path} r={r} on={r.path === current.file} open={tabs.includes(r.path)} onOpen={() => r.path !== current.file && void openProjectAt(r.path)} onMenu={(x, y) => setMenu({ x, y, r })} />
          ))}
          {shown.length === 0 && <div className="chathome-none">{recents.length ? "No project has that name." : "Your projects will be listed here."}</div>}
        </div>
      </aside>
      {menu && (
        <div className="chathome-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <div
            onClick={() => {
              void revealItemInDir(menu.r.path);
              setMenu(null);
            }}
          >
            <Icon name="folder" size={15} /> Show in Finder
          </div>
          {tabs.includes(menu.r.path) && (
            <div
              onClick={() => {
                void leave(menu.r.path);
                setMenu(null);
              }}
              title="Your work is saved."
            >
              <Icon name="close" size={15} /> Close
            </div>
          )}
          <div
            onClick={() => {
              removeRecent(menu.r.path);
              setMenu(null);
            }}
            title="Takes it off this list. The file is not deleted."
          >
            <Icon name="unlist" size={15} /> Remove from list
          </div>
          <div
            onClick={async () => {
              const r = menu.r;
              setMenu(null);
              if (tabs.includes(r.path) && !(await leave(r.path))) return;
              await trashProject(r.path).catch(() => undefined);
            }}
            title={`Kept ${TRASH_DAYS} days in the Trash, then cleared out.`}
          >
            <Icon name="trash" size={15} /> Move to Trash
          </div>
        </div>
      )}
      <section className="chathome-chat">
        {trash ? (
          <TrashView onBack={() => setTrash(false)} />
        ) : skills ? (
          <div className="chathome-skills">
            <div className="chathome-skills-head">
              <b>Skills</b>
              <button className="pill" onClick={() => setSkills(false)}>
                Back to chat
              </button>
            </div>
            <SkillsPanel />
          </div>
        ) : (
          <ChatPanel docked />
        )}
      </section>
      <main className="canvas viewonly" onDoubleClick={onEdit} title="Double-click to work on it in Edit">
        <CanvasView viewOnly />
        <button className="pill chathome-fit" onClick={() => window.dispatchEvent(new Event("duet:fit"))}>
          Find your design
        </button>
      </main>
    </div>
  );
}
