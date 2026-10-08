import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { getRecents, inTauri, newProject, openProject, openProjectAt, removeRecent } from "../project/project";
import type { Recent } from "../project/project";
import { getState, useStore } from "../state/store";
import { useDismiss } from "./useDismiss";
import Icon from "./Icons";

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

/** Your projects: every folder you have made or opened, with where it is and when you last used it. */
export default function Home({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [recents, setRecents] = useState<Recent[]>(getRecents());
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  useDismiss(!!project.path, onClose, ".home-card");

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

  const open = async (r: Recent) => {
    if (missing[r.path]) return;
    if (await openProjectAt(r.path)) onClose();
  };

  return (
    <div className="home">
      <div className="home-card">
        <div className="home-head">
          <div>
            <div className="home-title">
              Du<b>et</b>
            </div>
            <div className="home-sub">Your projects live in plain folders on your computer.</div>
          </div>
          {project.path && (
            <span className="pop-close" title="Back to your design" onClick={onClose}>
              ×
            </span>
          )}
        </div>

        <div className="home-actions">
          <button
            className="pill primary"
            onClick={async () => {
              const before = getState().project.path;
              await newProject();
              if (getState().project.path !== before) onClose();
            }}
          >
            New project
          </button>
          <button
            className="pill"
            onClick={async () => {
              const before = getState().project.path;
              await openProject();
              if (getState().project.path !== before) onClose();
            }}
          >
            Open a folder
          </button>
          {project.path && (
            <button className="pill" onClick={onClose}>
              Back to {project.name}
            </button>
          )}
        </div>

        <div className="home-h">Your projects</div>
        {recents.length === 0 && (
          <div className="home-empty">
            <b>Welcome. Here is how it goes.</b>
            <ol>
              <li>Press <b>New project</b> and choose where it lives. A project is just a folder.</li>
              <li>Press <b>F</b>, then drag to draw a frame. That is a screen. Draw shapes, text and lines inside it.</li>
              <li>Ask Duet in the chat for what you want. It works on the same canvas, in its own colour.</li>
            </ol>
            Nothing here yet. Your projects will show up in this list.
          </div>
        )}
        <div className="home-list">
          {recents.map((r) => (
            <div key={r.path} className={`home-row ${missing[r.path] ? "gone" : ""} ${project.path === r.path ? "now" : ""}`} onClick={() => open(r)}>
              <Icon name="frame" size={18} className="ico" />
              <div className="home-info">
                <div className="home-name">
                  {r.name} {project.path === r.path && <span className="home-tag">open now</span>}
                </div>
                <div className="home-path" title={r.path}>
                  {missing[r.path] ? "This folder was moved or deleted" : where(r.path)}
                </div>
              </div>
              <div className="home-when">{ago(r.opened)}</div>
              {!missing[r.path] && (
                <span
                  className="home-act"
                  title="Show in Finder"
                  onClick={(e) => {
                    e.stopPropagation();
                    void revealItemInDir(r.path);
                  }}
                >
                  Show in Finder
                </span>
              )}
              <span
                className="pop-close"
                title="Take it off this list. Your files are not deleted."
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecent(r.path);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
