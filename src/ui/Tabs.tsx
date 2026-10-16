import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { addTab, closeTab, getTabs, inTauri, openProjectAt, tabName } from "../project/project";
import { currentDoc, useStore } from "../state/store";

/** The projects you have open. One is live at a time; the others keep their history and are one click away. */
export default function Tabs() {
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

  const closeUnsaved = async () => {
    // opening another project asks about unsaved work by itself, so ask here only when none is left
    const next = list[list.length - 1];
    if (next) return void openProjectAt(next);
    if (!empty) {
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
    window.dispatchEvent(new Event("duet:home"));
  };

  return (
    <div className="project-tabs" role="tablist" data-tauri-drag-region>
      <button className="project-home" aria-label="All your projects" title="All your projects" onClick={() => window.dispatchEvent(new Event("duet:home"))}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 7.2 8 2.5l5.5 4.7V13a.5.5 0 0 1-.5.5H9.75V10h-3.5v3.5H3a.5.5 0 0 1-.5-.5Z" />
        </svg>
      </button>
      {list.map((path) => (
        <div key={path} role="tab" aria-selected={path === file} className={`project-tab ${path === file ? "active" : ""}`} title={path}>
          <button className="tab-name" onClick={() => path !== file && void openProjectAt(path)}>
            {tabName(path)}
          </button>
          <button
            className="tab-x"
            aria-label={`Close ${tabName(path)}`}
            onClick={() => {
              const next = closeTab(path);
              if (path !== file) return;
              if (next) void openProjectAt(next);
              else window.dispatchEvent(new Event("duet:home"));
            }}
          >
            ×
          </button>
        </div>
      ))}
      {!file && (
        <div key="unsaved" role="tab" aria-selected={true} className="project-tab active" title={project.name}>
          <button className="tab-name">{project.name}</button>
          <button className="tab-x" aria-label={`Close ${project.name}`} onClick={() => void closeUnsaved()}>
            ×
          </button>
        </div>
      )}
      <button
        className="project-tab-add"
        aria-label="Open or start a project"
        title="Open or start a project"
        onClick={() => window.dispatchEvent(new Event("duet:home"))}
      >
        +
      </button>
    </div>
  );
}
