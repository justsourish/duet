import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { addTab, closeProject, closeTab, getTabs, inTauri, openProjectAt, tabName } from "../project/project";
import { currentDoc, useStore } from "../state/store";
import { readyToLeave } from "../ai/agent";
import { useChat } from "../ai/chat";
import { outsideHomes } from "../ai/tools";

/**
 * The projects you have open, like tabs in a browser. One is on screen; the others wait with their
 * history, and an AI can keep working in one. A small dot shows where an AI is at work.
 * The home button shows all your projects; + starts a new design.
 */
export default function Tabs({ home, setHome }: { home: boolean; setHome: (on: boolean) => void }) {
  const project = useStore((s) => s.project);
  const empty = useStore((s) => currentDoc(s).rootIds.length === 0);
  const file = project.file;
  const [, again] = useState(0);
  const chatBusy = useChat((s) => s.busy);
  // an AI from outside says nothing when it stops, so look again now and then
  useEffect(() => {
    const t = setInterval(() => again((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, []);
  const working = new Set([...outsideHomes(), ...(chatBusy ? [chatBusy] : [])]);
  useEffect(() => {
    const redo = () => again((n) => n + 1);
    window.addEventListener("duet:tabs", redo);
    window.addEventListener("duet:recents", redo);
    return () => {
      window.removeEventListener("duet:tabs", redo);
      window.removeEventListener("duet:recents", redo);
    };
  }, []);
  // the project you are in is always one of them
  useEffect(() => {
    if (file) addTab(file);
  }, [file]);
  // whatever project is open always has its tab
  const list = file && !getTabs().includes(file) ? [...getTabs(), file] : getTabs();
  // an empty new project is not worth a tab while all your projects are showing
  const unsaved = !file && !(home && empty);

  const show = async (path: string) => {
    if (path === file || (await openProjectAt(path))) setHome(false);
  };

  /** What is left after the project on screen is closed: the next tab, or all your projects. */
  const afterClosing = async (rest: string[]) => {
    const next = rest[rest.length - 1];
    if (next) {
      if (await openProjectAt(next, true)) setHome(false);
      return;
    }
    if (!(await readyToLeave(true))) return;
    await closeProject();
    setHome(true);
  };

  const closeSaved = async (path: string) => {
    // the chat's AI may be at work in this project, even when it is not on screen
    if (!(await readyToLeave(true, path))) return;
    const rest = list.filter((p) => p !== path);
    closeTab(path);
    if (path === file) void afterClosing(rest);
  };

  /** Unsaved work is lost when it is left, so ask first. */
  const okToLeaveUnsaved = async (question: string, okLabel: string) =>
    file || empty || !inTauri() ? true : ask(question, { title: "Duet", kind: "warning", okLabel, cancelLabel: "Keep working" });

  const closeUnsaved = async () => {
    // opening another project asks about unsaved work by itself, so ask here only when none is left
    if (!list.length && !(await okToLeaveUnsaved("Your current work has not been saved. Close it anyway?", "Close"))) return;
    await afterClosing(list);
  };

  /** + starts a new, empty design in its own tab, like a new tab in a browser. Saved projects stay in their tabs. */
  const startNew = async () => {
    if (!(await okToLeaveUnsaved("Your current work has not been saved. Start a new design anyway?", "Start new"))) return;
    if (file || !empty) await closeProject();
    setHome(false);
  };

  return (
    <div className="project-tabs" role="tablist" data-tauri-drag-region>
      <button className={`project-home ${home ? "active" : ""}`} aria-label="All your projects" title="All your projects" onClick={() => setHome(true)}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 7.2 8 2.5l5.5 4.7V13a.5.5 0 0 1-.5.5H9.75V10h-3.5v3.5H3a.5.5 0 0 1-.5-.5Z" />
        </svg>
      </button>
      {list.map((path) => {
        const on = !home && path === file;
        return (
          <div key={path} role="tab" aria-selected={on} className={`project-tab ${on ? "active" : ""}`} title={path}>
            <button className="tab-name" onClick={() => void show(path)}>
              {working.has(path) && <i className="tab-busy" title="An AI is at work here" />}
              {tabName(path)}
            </button>
            <button className="tab-x" aria-label={`Close ${tabName(path)}`} onClick={() => void closeSaved(path)}>
              ×
            </button>
          </div>
        );
      })}
      {unsaved && (
        <div key="unsaved" role="tab" aria-selected={!home} className={`project-tab ${home ? "" : "active"}`} title={project.name}>
          <button className="tab-name" onClick={() => setHome(false)}>
            {project.name}
          </button>
          <button className="tab-x" aria-label={`Close ${project.name}`} onClick={() => void closeUnsaved()}>
            ×
          </button>
        </div>
      )}
      <button className="project-tab-add" aria-label="New design" title="New design" onClick={() => void startNew()}>
        +
      </button>
    </div>
  );
}
