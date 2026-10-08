import { useEffect } from "react";
import { detectAgent, startAgentListeners } from "./ai/agent";
import { startMcp } from "./ai/mcp";
import { loadSkills } from "./ai/skills";
import CanvasView from "./canvas/CanvasView";
import { inTauri, newProject, openProject, restoreLast, saveNow, startAutosave } from "./project/project";
import ChatPanel from "./ui/ChatPanel";
import HistoryStrip from "./ui/HistoryStrip";
import LayersPanel from "./ui/LayersPanel";
import PropertiesPanel from "./ui/PropertiesPanel";
import Toolbar from "./ui/Toolbar";
import { useStore } from "./state/store";
import "./styles.css";

const STATUS: Record<string, string> = {
  unsaved: "Not saved",
  saving: "Saving...",
  saved: "Saved",
  error: "Could not save",
};

export default function App() {
  const zoom = useStore((s) => s.viewport.zoom);
  const project = useStore((s) => s.project);

  useEffect(() => {
    const stop = startAutosave();
    restoreLast();
    const stops: (() => void)[] = [];
    let alive = true;
    if (inTauri()) {
      loadSkills();
      detectAgent();
      startMcp().then((f) => (alive ? stops.push(f) : f()));
      startAgentListeners().then((f) => (alive ? stops.push(f) : f()));
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        saveNow();
      } else if (k === "o") {
        e.preventDefault();
        openProject();
      } else if (k === "n") {
        e.preventDefault();
        newProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      stops.forEach((f) => f());
      stop();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="app">
      <header className="top">
        <span className="logo">
          Du<b>et</b>
        </span>
        <span className="crumb">/ {project.name}</span>
        <span className={`status ${project.status}`} title={project.error ?? undefined}>
          {project.path ? STATUS[project.status] : "Not saved yet"}
        </span>
        <span className="spacer" />
        <button className="pill" onClick={newProject} title="New project (Cmd or Ctrl N)">
          New
        </button>
        <button className="pill" onClick={openProject} title="Open project (Cmd or Ctrl O)">
          Open
        </button>
        {!project.path && (
          <button className="pill primary" onClick={saveNow} title="Save (Cmd or Ctrl S)">
            Save
          </button>
        )}
        <button className="pill" onClick={() => window.dispatchEvent(new Event("duet:fit"))} title="Zoom to fit (Shift 1)">
          {Math.round(zoom * 100)}%
        </button>
      </header>
      <LayersPanel />
      <main className="canvas">
        <CanvasView />
        <Toolbar />
        <ChatPanel />
      </main>
      <PropertiesPanel />
      <HistoryStrip />
    </div>
  );
}
