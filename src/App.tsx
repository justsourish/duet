import { useEffect, useState } from "react";
import { useDismiss } from "./ui/useDismiss";
import Tabs from "./ui/Tabs";
import { detectAgent, startAgentListeners } from "./ai/agent";
import { startMcp } from "./ai/mcp";
import { loadSkills } from "./ai/skills";
import CanvasView from "./canvas/CanvasView";
import { findProjects, flushPack, inTauri, newProject, openProject, openProjectAt, isCheckCopy, restoreLast, saveNow, startAutosave } from "./project/project";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ContextMenu from "./ui/ContextMenu";
import { installMenu } from "./ui/menu";
import { clampW, getLayout, setLayout, useLayout } from "./ui/layout";
import Icon from "./ui/Icons";
import ChatHome from "./ui/ChatHome";
import VideoCut from "./ui/VideoCut";
import TimeStrip from "./ui/TimeStrip";
import { wireClips } from "./video/play";
import { wireKeys } from "./video/keys";
import ChatPanel from "./ui/ChatPanel";
import ExportMenu from "./ui/ExportMenu";
import HistoryStrip from "./ui/HistoryStrip";
import PresentView from "./ui/PresentView";
import SendCopy from "./ui/SendCopy";
import Update from "./ui/Update";
import Feedback from "./ui/Feedback";
import Settings from "./ui/Settings";
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

wireClips();
wireKeys();

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function App() {
  const zoom = useStore((s) => s.viewport.zoom);
  const project = useStore((s) => s.project);
  const [zoomMenu, setZoomMenu] = useState(false);
  useDismiss(zoomMenu, () => setZoomMenu(false), ".zoomwrap.zoomonly");
  const [presenting, setPresenting] = useState(false);
  // there is no separate home any more: Chat is where your projects are
  const home = false;
  const setHome = (on: boolean) => on && setLayout({ space: "chat" });
  const [videoCut, setVideoCut] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState(false);
  const [check, setCheck] = useState(false);
  const dock = useLayout((d) => d);
  const hasFrames = useStore((s) => Object.values(s.timeline[s.cursor].doc.elements).some((e) => e.type === "frame"));

  useEffect(() => {
    const stop = startAutosave();
    // every launch starts at your projects; the last one is a click away ("Back to ...")
    void restoreLast().then(() => {
      if (isCheckCopy()) return setCheck(true);
    });
    const stops: (() => void)[] = [];
    let alive = true;
    if (inTauri()) {
      // a project file double-clicked in Finder or Explorer
      void invoke<string | null>("launch_file").then((f) => f && void openProjectAt(f));
      void listen<string>("open-file", (e) => void openProjectAt(e.payload));
      // make sure the last save is in the file before the window closes
      // a slow or failed save must never keep the window open
      void getCurrentWindow().onCloseRequested(async (e) => {
        // an AI is still working: hide the window and let it finish; Duet quits when it is done
        if (await invoke<boolean>("keep_running_for_ai").catch(() => false)) {
          e.preventDefault();
        }
        await Promise.race([flushPack().catch(() => undefined), new Promise((done) => setTimeout(done, 4000))]);
      });
      // projects in Documents/Duet always show up in the list, even ones made before this app knew them
      void invoke<string>("default_projects_dir").then((d) => findProjects(d)).catch(() => undefined);
      void installMenu();
      loadSkills();
      detectAgent();
      startMcp().then((f) => (alive ? stops.push(f) : f()));
      startAgentListeners().then((f) => (alive ? stops.push(f) : f()));
    }
    // the menu bar and other parts of the app ask for these
    const openHome = () => setLayout({ space: "chat" });
    const openPresent = () => setPresenting(true);
    const openSend = () => setSending(true);
    const openSettings = () => setSettings(true);
    const openVideoCut = () => setVideoCut(true);
    const rebuildMenu = () => void installMenu();
    window.addEventListener("duet:home", openHome);
    window.addEventListener("duet:present", openPresent);
    window.addEventListener("duet:send-copy", openSend);
    window.addEventListener("duet:settings", openSettings);
    window.addEventListener("duet:video-cut", openVideoCut);
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
      } else if (k === "1" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLayout({ mode: "design" });
      } else if (k === "2" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLayout({ mode: "motion" });
      } else if (k === "3" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLayout({ mode: "color" });
      } else if (k === ",") {
        e.preventDefault();
        setSettings(true);
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
      window.removeEventListener("duet:send-copy", openSend);
      window.removeEventListener("duet:settings", openSettings);
      window.removeEventListener("duet:video-cut", openVideoCut);
      window.removeEventListener("duet:recents", rebuildMenu);
    };
  }, []);

  // The grid follows the panels: their widths, which side they are on, and whether they are shown.
  const lw = dock.leftHidden ? 0 : dock.leftW;
  const rw = dock.rightHidden ? 0 : dock.rightW;
  const chatting = dock.space === "chat";
  const appStyle = chatting
    ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "var(--tabbar-h) 44px minmax(0, 1fr) 48px", gridTemplateAreas: '"tabs" "top" "chathome" "hist"' }
    : {
    gridTemplateColumns: dock.swapped ? `auto ${rw}px 1fr ${lw}px` : `auto ${lw}px 1fr ${rw}px`,
    gridTemplateAreas: dock.swapped
      ? '"tabs tabs tabs tabs" "top top top top" "tools right canvas left" "time time time time" "hist hist hist hist"'
      : '"tabs tabs tabs tabs" "top top top top" "tools left canvas right" "time time time time" "hist hist hist hist"',
  };

  return (
    <div className={`app ${dock.swapped ? "swapped" : ""} ${check ? "check" : ""} ${MAC ? "mac" : ""}`} style={appStyle}>
      {/* open projects, in their own row like a browser; on a Mac it shares the row with the window buttons */}
      <div className="tabbar" data-tauri-drag-region>
        {!chatting && <Tabs home={home} setHome={setHome} />}
      </div>
      <header className="top">
        <div className="top-side">
          <span className="logo">
            Du<b>et</b>
            {check && <i className="checkmark" title="Duet dev, used only to build and check Duet itself. It never opens your projects by itself.">dev</i>}
          </span>
          <div className="pill mode-switch space-switch">
            <button className={chatting ? "active" : ""} data-name="space-chat" onClick={() => setLayout({ space: "chat" })}>
              Chat
            </button>
            <button className={chatting ? "" : "active"} data-name="space-edit" onClick={() => setLayout({ space: "edit" })}>
              Edit
            </button>
          </div>
          <span className={`status ${project.status}`} title={project.error ?? undefined}>
            {project.path ? STATUS[project.status] : "Not saved yet"}
          </span>
        </div>
        {!chatting && (
        <div className="pill mode-switch">
          <button
            className={dock.mode === "design" ? "active" : ""}
            data-name="mode-design"
            onClick={() => setLayout({ mode: "design" })}
          >
            Design
          </button>
          <button
            className={dock.mode === "motion" ? "active" : ""}
            data-name="mode-motion"
            onClick={() => setLayout({ mode: "motion" })}
          >
            Motion
          </button>
          <button
            className={dock.mode === "color" ? "active" : ""}
            data-name="mode-color"
            onClick={() => setLayout({ mode: "color" })}
          >
            Colour
          </button>
        </div>
        )}
        {chatting && <div />}
        <div className="top-side end">
          {dock.mode === "design" && (
            <button className="pill" disabled={!hasFrames} onClick={() => setPresenting(true)} title="Click through your screens (Cmd or Ctrl Enter)">
              Present
            </button>
          )}
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
        </div>
      </header>
      {chatting ? (
        <ChatHome onEdit={() => setLayout({ space: "edit" })} />
      ) : (
        <>
          <Toolbar />
          {!dock.leftHidden && <LayersPanel />}
          <main className="canvas">
            <CanvasView />
            <Grip side="l" />
            <Grip side="r" />
            <ChatPanel />
          </main>
          {!dock.rightHidden && <PropertiesPanel />}
          <TimeStrip />
        </>
      )}
      <HistoryStrip />
      {presenting && <PresentView onClose={() => setPresenting(false)} />}
      <ContextMenu />
      {videoCut && <VideoCut onClose={() => setVideoCut(false)} />}
      {sending && <SendCopy onClose={() => setSending(false)} />}
      <Update />
      <Feedback />
      {settings && <Settings check={check} onClose={() => setSettings(false)} />}
    </div>
  );
}
