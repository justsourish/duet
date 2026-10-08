import { useEffect, useState } from "react";
import { useDismiss } from "./ui/useDismiss";
import { detectAgent, startAgentListeners } from "./ai/agent";
import { startMcp } from "./ai/mcp";
import { loadSkills } from "./ai/skills";
import CanvasView from "./canvas/CanvasView";
import { inTauri, newProject, openProject, restoreLast, saveNow, startAutosave } from "./project/project";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import ContextMenu from "./ui/ContextMenu";
import { installMenu } from "./ui/menu";
import { clampW, getLayout, setLayout, useLayout } from "./ui/layout";
import Icon from "./ui/Icons";
import Home from "./ui/Home";
import ChatPanel from "./ui/ChatPanel";
import ExportMenu from "./ui/ExportMenu";
import HistoryStrip from "./ui/HistoryStrip";
import PresentView from "./ui/PresentView";
import LayersPanel from "./ui/LayersPanel";
import PropertiesPanel from "./ui/PropertiesPanel";
import Toolbar from "./ui/Toolbar";
import { getState, useStore } from "./state/store";
import "./styles.css";

const STATUS: Record<string, string> = {
  unsaved: "Not saved",
  saving: "Saving...",
  saved: "Saved",
  error: "Could not save",
};

/** A thin handle on the edge of the canvas: drag it to make the panel next to it wider or narrower. */
function Grip({ side }: { side: "l" | "r" }) {
  const dock = useLayout((d) => d);
  // which panel is on this side of the canvas
  const key = (side === "l") !== dock.swapped ? "leftW" : "rightW";
  const hidden = key === "leftW" ? dock.leftHidden : dock.rightHidden;
  if (hidden) return null;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = getLayout()[key];
    const move = (m: PointerEvent) => setLayout({ [key]: clampW(startW + (side === "l" ? m.clientX - startX : startX - m.clientX)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={`grip grip-${side}`} onPointerDown={down} onDoubleClick={() => setLayout({ [key]: key === "leftW" ? 232 : 248 })} title="Drag to resize. Double-click to reset." />;
}

export default function App() {
  const zoom = useStore((s) => s.viewport.zoom);
  const project = useStore((s) => s.project);
  const [zoomMenu, setZoomMenu] = useState(false);
  useDismiss(zoomMenu, () => setZoomMenu(false), ".zoomwrap.zoomonly");
  const [presenting, setPresenting] = useState(false);
  const [home, setHome] = useState(false);
  const dock = useLayout((d) => d);
  const hasFrames = useStore((s) => Object.values(s.timeline[s.cursor].doc.elements).some((e) => e.type === "frame"));

  useEffect(() => {
    const stop = startAutosave();
    // go back to where you were; if there is nowhere to go back to, start at your projects
    void restoreLast().then(() => {
      if (inTauri() && !getState().project.path && getState().timeline.length <= 1) setHome(true);
    });
    const stops: (() => void)[] = [];
    let alive = true;
    if (inTauri()) {
      void installMenu();
      loadSkills();
      detectAgent();
      startMcp().then((f) => (alive ? stops.push(f) : f()));
      startAgentListeners().then((f) => (alive ? stops.push(f) : f()));
    }
    // the menu bar and other parts of the app ask for these
    const openHome = () => setHome(true);
    const openPresent = () => setPresenting(true);
    const rebuildMenu = () => void installMenu();
    window.addEventListener("duet:home", openHome);
    window.addEventListener("duet:present", openPresent);
    window.addEventListener("duet:recents", rebuildMenu);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "enter") {
        e.preventDefault();
        setPresenting(true);
      } else if (k === "s" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new Event("duet:versions"));
      } else if (k === "s") {
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
      window.removeEventListener("duet:home", openHome);
      window.removeEventListener("duet:present", openPresent);
      window.removeEventListener("duet:recents", rebuildMenu);
    };
  }, []);

  // The grid follows the panels: their widths, which side they are on, and whether they are shown.
  const lw = dock.leftHidden ? 0 : dock.leftW;
  const rw = dock.rightHidden ? 0 : dock.rightW;
  const appStyle = {
    gridTemplateColumns: dock.swapped ? `${rw}px 1fr ${lw}px` : `${lw}px 1fr ${rw}px`,
    gridTemplateAreas: dock.swapped ? '"top top top" "right canvas left" "hist hist hist"' : '"top top top" "left canvas right" "hist hist hist"',
  };

  return (
    <div className={`app ${dock.swapped ? "swapped" : ""}`} style={appStyle}>
      <header className="top">
        <span className="logo">
          Du<b>et</b>
        </span>
        <button className="pill" onClick={() => setHome(true)} title="All your projects">
          Projects
        </button>
        <span className="crumb">/ {project.name}</span>
        {project.path && (
          <span className="crumb-path" title={`${project.path}\nClick to show it in Finder`} onClick={() => void revealItemInDir(project.path as string)}>
            {project.path.replace(/^\/Users\/[^/]+/, "~")}
          </span>
        )}
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
        <button className="pill" disabled={!hasFrames} onClick={() => setPresenting(true)} title="Click through your screens (Cmd or Ctrl Enter)">
          Present
        </button>
        <button className={`pill icon ${dock.leftHidden ? "" : "on"}`} title="Show or hide the layers panel" onClick={() => setLayout({ leftHidden: !dock.leftHidden })}>
          <Icon name="panel-left" size={15} />
        </button>
        <button className={`pill icon ${dock.rightHidden ? "" : "on"}`} title="Show or hide the design panel" onClick={() => setLayout({ rightHidden: !dock.rightHidden })}>
          <Icon name="panel-right" size={15} />
        </button>
        <ExportMenu />
        <div className="zoomwrap zoomonly">
          <button className="pill" onClick={() => setZoomMenu(!zoomMenu)} title="Zoom">
            {Math.round(zoom * 100)}%
          </button>
          {zoomMenu && (
            <div className="zmenu" onClick={() => setZoomMenu(false)}>
              <div onClick={() => window.dispatchEvent(new Event("duet:fit"))}>
                Fit everything <kbd>Shift 1</kbd>
              </div>
              <div onClick={() => window.dispatchEvent(new CustomEvent("duet:fit-selection"))}>
                Zoom to selection <kbd>Shift 2</kbd>
              </div>
              {[0.5, 1, 2].map((z) => (
                <div key={z} onClick={() => window.dispatchEvent(new CustomEvent("duet:zoom", { detail: z }))}>
                  {z * 100}%
                </div>
              ))}
            </div>
          )}
        </div>
      </header>
      {!dock.leftHidden && <LayersPanel />}
      <main className="canvas">
        <CanvasView />
        <Grip side="l" />
        <Grip side="r" />
        <Toolbar />
        <ChatPanel />
      </main>
      {!dock.rightHidden && <PropertiesPanel />}
      <HistoryStrip />
      {presenting && <PresentView onClose={() => setPresenting(false)} />}
      <ContextMenu />
      {home && <Home onClose={() => setHome(false)} />}
    </div>
  );
}
