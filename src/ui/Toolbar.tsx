import { setTool, useStore } from "../state/store";
import type { Tool } from "../state/store";

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "move", label: "Move", key: "V", icon: <path d="M5 3l14 8-6 2-2 6z" /> },
  { tool: "frame", label: "Frame", key: "F", icon: <path d="M7 3v18M17 3v18M3 7h18M3 17h18" /> },
  { tool: "rect", label: "Rectangle", key: "R", icon: <rect x="4" y="5" width="16" height="14" rx="2" /> },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: <circle cx="12" cy="12" r="8" /> },
  { tool: "text", label: "Text", key: "T", icon: <path d="M5 6h14M12 6v13" /> },
  {
    tool: "hand",
    label: "Hand",
    key: "H",
    icon: <path d="M8 13V6a1.5 1.5 0 013 0v5m0-1V4.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-3.5a1.5 1.5 0 012.5-1.5L8 14" />,
  },
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
          <svg viewBox="0 0 24 24">{t.icon}</svg>
        </button>
      ))}
    </div>
  );
}
