import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { findProjects, getRecents, inTauri, newProject, openOldFolder, openProject, openProjectAt, removeRecent } from "../project/project";
import type { Recent } from "../project/project";
import { getState, useStore } from "../state/store";
import { useDismiss } from "./useDismiss";

/** How long ago, in plain words. */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The folder a project lives in, with your home folder shortened to ~. */
function where(path: string): string {
  const parent = path.replace(/[\\/][^\\/]+[\\/]?$/, "");
  return parent.replace(/^\/Users\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
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

function Card({ r, now, gone, onOpen }: { r: Recent; now: boolean; gone: boolean; onOpen: () => void }) {
  const own = usePreview(r.thumb ? "" : r.path);
  const src = r.thumb ?? own;
  return (
    <div className={`pcard ${gone ? "gone" : ""} ${now ? "now" : ""}`} onClick={onOpen}>
      <div className="pthumb">{src ? <img src={src} alt="" /> : <span>{gone ? "Moved or deleted" : "No preview yet"}</span>}</div>
      <div className="pmeta">
        <div className="pname">
          {r.name} {now && <span className="home-tag">open now</span>}
        </div>
        <div className="ppath" title={r.path}>
          {where(r.path)}
        </div>
        <div className="pwhen">{ago(r.opened)}</div>
      </div>
      <div className="pacts">
        {!gone && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              void revealItemInDir(r.path);
            }}
          >
            Show in Finder
          </span>
        )}
        <span
          title="Take it off this list. Your files are not deleted."
          onClick={(e) => {
            e.stopPropagation();
            removeRecent(r.path);
          }}
        >
          Remove
        </span>
      </div>
    </div>
  );
}

/** Your projects, as a page: a grid with a picture of each, where it lives, and when you last used it. */
export default function Home({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [recents, setRecents] = useState<Recent[]>(getRecents());
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [note, setNote] = useState("");
  useDismiss(!!project.path, onClose, ".home-main, .home-side");

  useEffect(() => {
    const refresh = () => setRecents(getRecents());
    window.addEventListener("duet:recents", refresh);
    return () => window.removeEventListener("duet:recents", refresh);
  }, []);

  useEffect(() => {
    if (!inTauri()) return;
    let alive = true;
    Promise.all(
      recents.map(async (r) => [r.path, (await invoke<boolean>("path_exists", { path: r.path }).catch(() => false)) === false] as const),
    ).then((pairs) => alive && setMissing(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [recents]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = recents.filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
    return sort === "name" ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : [...list].sort((a, b) => b.opened - a.opened);
  }, [recents, query, sort]);

  const openIt = async (r: Recent) => {
    if (missing[r.path]) return;
    if (await openProjectAt(r.path)) onClose();
  };
  const make = async () => {
    const before = getState().project.path;
    await newProject();
    if (getState().project.path !== before) onClose();
  };
  const browse = async () => {
    const before = getState().project.path;
    await openProject();
    if (getState().project.path !== before) onClose();
  };
  const find = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a folder to look through for Duet projects" });
    if (typeof dir !== "string") return;
    setNote("Looking...");
    const n = await findProjects(dir);
    setNote(n === 0 ? "No new projects found there." : n === 1 ? "Found 1 project." : `Found ${n} projects.`);
  };

  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-title">
          Du<b>et</b>
        </div>
        <button className="pill primary wide" onClick={make}>
          New project
        </button>
        <button className="pill wide" onClick={browse}>
          Open a file
        </button>
        <button className="pill wide" onClick={async () => {
          const before = getState().project.path;
          await openOldFolder();
          if (getState().project.path !== before) onClose();
        }}>
          Open an older folder
        </button>
        <button className="pill wide" onClick={find}>
          Find my projects
        </button>
        {note && <div className="hint2">{note}</div>}
        <div className="spacer" />
        {project.path && (
          <button className="pill wide" onClick={onClose}>
            Back to {project.name}
          </button>
        )}
        <div className="hint2">New projects go in Documents/Duet. Each project is one .duet file, with its history inside.</div>
      </aside>

      <main className="home-main">
        <div className="home-bar">
          <input className="home-search" placeholder="Search your projects" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <select className="home-sort" value={sort} onChange={(e) => setSort(e.target.value as "recent" | "name")}>
            <option value="recent">Last opened</option>
            <option value="name">Name</option>
          </select>
          {project.path && (
            <span className="pop-close" title="Back to your design" onClick={onClose}>
              ×
            </span>
          )}
        </div>

        {recents.length === 0 ? (
          <div className="home-empty">
            <b>Welcome. Here is how it goes.</b>
            <ol>
              <li>Press <b>New project</b> and choose where it lives. A project is just a folder.</li>
              <li>Press <b>F</b>, then drag to draw a frame. That is a screen. Draw shapes, text and lines inside it.</li>
              <li>Ask Duet in the chat for what you want. It works on the same canvas, in its own colour.</li>
            </ol>
            Already have projects somewhere? Press <b>Find my projects</b> and choose a folder to look through.
          </div>
        ) : (
          <>
            <div className="home-h">
              {query ? `${shown.length} found` : `Your projects (${recents.length})`}
            </div>
            <div className="pgrid">
              <div className="pcard pnew" onClick={make}>
                <div className="pthumb">
                  <span>+</span>
                </div>
                <div className="pmeta">
                  <div className="pname">New project</div>
                </div>
              </div>
              {shown.map((r) => (
                <Card key={r.path} r={r} now={(project.file ?? project.path) === r.path} gone={!!missing[r.path]} onOpen={() => openIt(r)} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
