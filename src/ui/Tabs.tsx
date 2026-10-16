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
    const next = list[list.length - 1];
    if (next) void openProjectAt(next);
    else window.dispatchEvent(new Event("duet:home"));
  };

  return (
    <div className="project-tabs" role="tablist">
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
