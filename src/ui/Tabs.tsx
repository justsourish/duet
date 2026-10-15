import { useEffect, useState } from "react";
import { addTab, closeTab, getTabs, openProjectAt, tabName } from "../project/project";
import { useStore } from "../state/store";

/** The projects you have open. One is live at a time; the others keep their history and are one click away. */
export default function Tabs() {
  const file = useStore((s) => s.project.file);
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
  if (list.length < 2) return null;
  return (
    <div className="tabs" role="tablist">
      {list.map((path) => (
        <div key={path} role="tab" aria-selected={path === file} className={`tab ${path === file ? "active" : ""}`} title={path}>
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
    </div>
  );
}
