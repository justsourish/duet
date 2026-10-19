import { useMemo, useState } from "react";
import CanvasView from "../canvas/CanvasView";
import { getRecents, inTauri, newProject, openProjectAt } from "../project/project";
import { useStore } from "../state/store";
import ChatPanel from "./ChatPanel";

/** Projects that match what was typed, newest first as they are kept. */
export function matchProjects<T extends { name: string }>(all: T[], typed: string): T[] {
  const t = typed.trim().toLowerCase();
  return t ? all.filter((r) => r.name.toLowerCase().includes(t)) : all;
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
  const shown = matchProjects(recents, typed);

  return (
    <div className="chathome">
      <aside className="chathome-projects">
        <div className="chathome-head">
          <b>Projects</b>
          <button className="pill primary" onClick={() => void newProject()} disabled={!inTauri()}>
            New
          </button>
        </div>
        <input className="chathome-find" placeholder="Find a project" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="chathome-list">
          {shown.map((r) => (
            <div
              key={r.path}
              className={`chathome-row ${r.path === current.file ? "on" : ""}`}
              onClick={() => r.path !== current.file && void openProjectAt(r.path)}
              title={r.path}
            >
              {r.name}
            </div>
          ))}
          {shown.length === 0 && <div className="chathome-none">{recents.length ? "No project has that name." : "Your projects will be listed here."}</div>}
        </div>
      </aside>
      <section className="chathome-chat">
        <ChatPanel docked />
      </section>
      <main className="canvas viewonly" onDoubleClick={onEdit} title="Double-click to work on it in Edit">
        <CanvasView viewOnly />
      </main>
    </div>
  );
}
