import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { addTab, closeProject, closeTab, getTabs, inTauri, openProjectAt, tabName } from "../project/project";
import { currentDoc, useStore } from "../state/store";

/**
 * The projects you have open, like tabs in a browser. One is live at a time; the others keep their
 * history and are one click away. The home button and + show all your projects, the way a new tab does.
 */
export default function Tabs({ home, setHome }: { home: boolean; setHome: (on: boolean) => void }) {
  const project = useStore((s) => s.project);
  const empty = useStore((s) => currentDoc(s).rootIds.length === 0);
  const file = project.file;
  const [, again] = useState(0);
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
  const list = getTabs();
  // an empty new project is not worth a tab while all your projects are showing
  const unsaved = !file && !(home && empty);

  const show = async (path: string) => {
    if (path === file || (await openProjectAt(path))) setHome(false);
  };

  /** What is left after the project on screen is closed: the next tab, or all your projects. */
  const afterClosing = async (rest: string[]) => {
    const next = rest[rest.length - 1];
    if (next) {
      if (await openProjectAt(next)) setHome(false);
      return;
    }
    await closeProject();
    setHome(true);
  };

  const closeSaved = (path: string) => {
    const rest = getTabs().filter((p) => p !== path);
    closeTab(path);
    if (path === file) void afterClosing(rest);
  };

  const closeUnsaved = async () => {
    // opening another project asks about unsaved work by itself, so ask here only when none is left
    if (!list.length && !empty) {
      const go = inTauri()
        ? await ask("Your current work has not been saved. Close it anyway?", {
            title: "Duet",
            kind: "warning",
            okLabel: "Close",
            cancelLabel: "Keep working",
          })
        : true;
      if (!go) return;
    }
    await afterClosing(list);
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
              {tabName(path)}
            </button>
            <button className="tab-x" aria-label={`Close ${tabName(path)}`} onClick={() => closeSaved(path)}>
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
      <button className="project-tab-add" aria-label="Open or start a project" title="Open or start a project" onClick={() => setHome(true)}>
        +
      </button>
    </div>
  );
}
