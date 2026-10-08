import CanvasView from "./canvas/CanvasView";
import HistoryStrip from "./ui/HistoryStrip";
import LayersPanel from "./ui/LayersPanel";
import PropertiesPanel from "./ui/PropertiesPanel";
import Toolbar from "./ui/Toolbar";
import { useStore } from "./state/store";
import "./styles.css";

export default function App() {
  const zoom = useStore((s) => s.viewport.zoom);
  return (
    <div className="app">
      <header className="top">
        <span className="logo">
          Du<b>et</b>
        </span>
        <span className="crumb">/ Untitled</span>
        <span className="spacer" />
        <button className="pill" onClick={() => window.dispatchEvent(new Event("duet:fit"))} title="Zoom to fit (Shift 1)">
          {Math.round(zoom * 100)}%
        </button>
      </header>
      <LayersPanel />
      <main className="canvas">
        <CanvasView />
        <Toolbar />
      </main>
      <PropertiesPanel />
      <HistoryStrip />
    </div>
  );
}
