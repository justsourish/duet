import { useEffect, useState } from "react";
import { SHORTCUTS, keyText } from "./shortcuts";
import { BUILDER_TOOLS } from "../ai/builder";
import { AGENTS, useChat } from "../ai/chat";
import { busyOutside } from "../ai/outside";
import { toolName } from "../ai/who";
import { useStore } from "../state/store";
import { getVersion } from "@tauri-apps/api/app";

interface SettingsProps {
  check?: boolean;
  onClose: () => void;
}

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function Settings({ check = false, onClose }: SettingsProps) {
  const [section, setSection] = useState<"Keyboard shortcuts" | "General" | "Developer">("Keyboard shortcuts");
  const [version, setVersion] = useState("");
  useEffect(() => void getVersion().then(setVersion).catch(() => undefined), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const agent = useChat((s) => s.agent);
  const running = useChat((s) => s.running);
  const agentName = AGENTS.find((a) => a.id === agent)?.name ?? toolName(agent) ?? agent;
  const projectName = useStore((s) => s.project.name);

  const busy = busyOutside();
  const who = running
    ? (toolName(AGENTS.find((a) => a.id === agent)?.name) ?? toolName(agent) ?? agent)
    : busy
    ? (toolName(busy) ?? busy)
    : undefined;
  const workingNow = who ?? "No one";

  const sections = check ? (["Keyboard shortcuts", "General", "Developer"] as const) : (["Keyboard shortcuts", "General"] as const);
  const activeSection = section === "Developer" && !check ? "General" : section;

  return (
    <div className="settings-screen" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <header className="settings-bar">
        <button className="pill" onClick={onClose} title="Back (Esc)">
          ← Back
        </button>
        <span className="settings-title">Settings</span>
      </header>
      <main className="settings-main">
        <aside className="settings-left">
          <div className="settings-nav">
            {sections.map((s) => (
              <button
                key={s}
                className={`settings-nav-btn ${activeSection === s ? "active" : ""}`}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </aside>
        <section className="settings-right">
          {activeSection === "Keyboard shortcuts" && (
            <div className="settings-content">
              <div className="settings-section-title">Keyboard shortcuts</div>
              {SHORTCUTS.map((g) => (
                <div key={g.group} className="shortcut-group">
                  <div className="settings-subtitle">{g.group}</div>
                  {g.keys.map(([keys, what]) => (
                    <div key={g.group + keys} className="shortcut-row">
                      <span>{what}</span>
                      <kbd>{keyText(keys, MAC)}</kbd>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {activeSection === "General" && (
            <div className="settings-content">
              <div className="settings-section-title">General</div>
              <div className="settings-row">
                <span>AI tool:</span> <b>{agentName}</b>
              </div>
              <div className="settings-row">
                <span>Duet version:</span> <b>{version || "?"}</b>
                <button
                  className="mini"
                  data-name="check-update"
                  onClick={() => {
                    onClose();
                    window.dispatchEvent(new Event("duet:check-update"));
                  }}
                >
                  Check for updates
                </button>
              </div>
            </div>
          )}
          {activeSection === "Developer" && check && (
            <div className="settings-content">
              <div className="settings-section-title">Developer</div>
              <div className="settings-meta">
                <div className="settings-row">
                  <span>Open project:</span> <b>{projectName}</b>
                </div>
                <div className="settings-row">
                  <span>Who is working now:</span> <b>{workingNow}</b>
                </div>
              </div>
              <div className="settings-subtitle">Builder tools</div>
              <div className="settings-tools-list">
                {BUILDER_TOOLS.map((tool) => (
                  <div key={tool.name} className="settings-tool-row">
                    <span className="settings-tool-name">{tool.name}</span>
                    <span className="settings-tool-desc">{tool.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
