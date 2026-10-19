import { setTool, useStore } from "../state/store";
import type { Tool } from "../state/store";
import { pickImages } from "../project/imageImport";
import { cutNow } from "../video/edit";
import type { CutKind } from "../video/edit";
import Icon from "./Icons";
import type { IconName } from "./Icons";
import { useLayout } from "./layout";

/** The tools, in a strip down the left edge. Motion adds the cutting tools below the drawing ones, so nothing else moves. */

const TOOLS: { tool: Tool; label: string; key: string; icon: IconName }[] = [
  { tool: "move", label: "Move", key: "V", icon: "move" },
  { tool: "frame", label: "Frame", key: "F", icon: "frame" },
  { tool: "rect", label: "Rectangle", key: "R", icon: "rect" },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: "ellipse" },
  { tool: "pen", label: "Pen", key: "P", icon: "pen" },
  { tool: "text", label: "Text", key: "T", icon: "text" },
  { tool: "hand", label: "Hand", key: "H", icon: "hand" },
  { tool: "zoom", label: "Zoom", key: "Z", icon: "zoom" },
];

const CUTS: { kind: CutKind; label: string; key: string; icon: IconName }[] = [
  { kind: "split", label: "Cut here", key: "S", icon: "cut-here" },
  { kind: "remove", label: "Delete and close the gap", key: "D", icon: "cut-close" },
  { kind: "before", label: "Cut away what comes before", key: "Q", icon: "cut-before" },
  { kind: "after", label: "Cut away what comes after", key: "W", icon: "cut-after" },
];

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  const scene = useStore((s) => s.clock.scene);
  const motion = useLayout((d) => d.mode === "motion");
  return (
    <div className="toolbar" data-name="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`tool ${tool === t.tool ? "on" : ""}`}
          title={`${t.label} (${t.key})`}
          onClick={() => setTool(t.tool)}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      <button className="tool" title="Image (Shift Cmd K)" onClick={() => void pickImages()}>
        <Icon name="image" />
      </button>
      {motion && (
        <>
          <span className="tool-gap" />
          {CUTS.map((c) => (
            <button
              key={c.kind}
              className="tool"
              data-name={`cut-${c.kind}`}
              disabled={!scene}
              title={scene ? `${c.label} (${c.key})` : `${c.label}. Select a scene first`}
              onClick={() => cutNow(c.kind)}
            >
              <Icon name={c.icon} />
            </button>
          ))}
        </>
      )}
      <button
        className="tool tool-settings"
        title="Settings"
        onClick={() => window.dispatchEvent(new Event("duet:settings"))}
      >
        <Icon name="settings" />
      </button>
    </div>
  );
}
