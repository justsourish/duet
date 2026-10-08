import { setTool, useStore } from "../state/store";
import type { Tool } from "../state/store";
import Icon from "./Icons";
import type { IconName } from "./Icons";

const TOOLS: { tool: Tool; label: string; key: string; icon: IconName }[] = [
  { tool: "move", label: "Move", key: "V", icon: "move" },
  { tool: "frame", label: "Frame", key: "F", icon: "frame" },
  { tool: "rect", label: "Rectangle", key: "R", icon: "rect" },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: "ellipse" },
  { tool: "text", label: "Text", key: "T", icon: "text" },
  { tool: "hand", label: "Hand", key: "H", icon: "hand" },
];

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  return (
    <div className="toolbar">
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
    </div>
  );
}
