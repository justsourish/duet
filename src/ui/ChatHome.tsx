import { useEffect, useMemo, useState } from "react";
import CanvasView from "../canvas/CanvasView";
import type { Recent } from "../project/project";
import { getRecents, inTauri, newProject, openProjectAt } from "../project/project";
import { getState, setViewport, useStore } from "../state/store";
import ChatPanel from "./ChatPanel";
import Icon from "./Icons";
import SkillsPanel from "./SkillsPanel";
import { ago, usePreview } from "./Home";

/** Projects that match what was typed, newest first as they are kept. */
export function matchProjects<T extends { name: string }>(all: T[], typed: string): T[] {
  const t = typed.trim().toLowerCase();
  return t ? all.filter((r) => r.name.toLowerCase().includes(t)) : all;
}

/** One project in the list: its picture, its name and when it was last opened. */
function ProjectRow({ r, on, onOpen }: { r: Recent; on: boolean; onOpen: () => void }) {
  const own = usePreview(r.thumb ? "" : r.path);
  const src = r.thumb ?? own;
  return (
    <div className={`chathome-row ${on ? "on" : ""}`} onClick={onOpen} title={r.path}>
      <div className="chathome-thumb">{src ? <img src={src} alt="" /> : null}</div>
      <div className="chathome-meta">
        <div className="chathome-name">{r.name}</div>
        <div className="chathome-when">{ago(r.opened)}</div>
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
  const [skills, setSkills] = useState(false);
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
          <button className={`chathome-item ${skills ? "on" : ""}`} onClick={() => setSkills(!skills)}>
            <Icon name="skills" size={16} /> Skills
          </button>
          <button className="chathome-item" onClick={() => window.dispatchEvent(new Event("duet:settings"))}>
            <Icon name="settings" size={16} /> Settings
          </button>
        </div>
        <div className="chathome-label">Projects</div>
        <div className="chathome-list">
          {shown.map((r) => (
            <ProjectRow key={r.path} r={r} on={r.path === current.file} onOpen={() => r.path !== current.file && void openProjectAt(r.path)} />
          ))}
          {shown.length === 0 && <div className="chathome-none">{recents.length ? "No project has that name." : "Your projects will be listed here."}</div>}
        </div>
      </aside>
      <section className="chathome-chat">
        {skills ? (
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
