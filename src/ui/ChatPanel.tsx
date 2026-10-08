import { useEffect, useRef, useState } from "react";
import { sendToAgent, stopAgent } from "../ai/agent";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../project/project";
import { AGENTS, CLAUDE_MODELS, EFFORTS, answerApproval, setEffort, setModel, newConversation, setAgent, setMinimized, setMode, updateMsg, useChat } from "../ai/chat";
import type { ModelChoice } from "../ai/chat";
import type { AgentId } from "../ai/chat";
import type { Mode } from "../ai/chat";
import { applyProposal, undoAiStep } from "../ai/tools";
import { useStore } from "../state/store";
import { setLayout, useLayout } from "./layout";
import type { Corner } from "./layout";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "suggest", label: "Suggest", hint: "Duet only suggests. Nothing changes until you tap Apply." },
  { mode: "ask", label: "Ask first", hint: "Duet makes design changes. It asks before deleting anything." },
  { mode: "auto", label: "Auto", hint: "Duet does what you ask on its own. You can undo any step." },
];

const IDEAS = ["Describe this design", "Tidy the spacing", "Check text contrast"];

export default function ChatPanel() {
  const messages = useChat((s) => s.messages);
  const mode = useChat((s) => s.mode);
  const running = useChat((s) => s.running);
  const minimized = useChat((s) => s.minimized);
  const found = useChat((s) => s.agentFound);
  const agent = useChat((s) => s.agent);
  const installed = useChat((s) => s.installed);
  const models = useChat((s) => s.models);
  const effort = useChat((s) => s.effort);
  const [agyModels, setAgyModels] = useState<ModelChoice[]>([]);
  useEffect(() => {
    if (agent !== "agy" || agyModels.length || !inTauri()) return;
    invoke<ModelChoice[]>("agent_models", { program: "agy" })
      .then((list) => setAgyModels([{ id: "", name: "Default" }, ...list]))
      .catch(() => setAgyModels([{ id: "", name: "Default" }]));
  }, [agent, agyModels.length]);
  const modelList = agent === "agy" ? (agyModels.length ? agyModels : [{ id: "", name: "Default" }]) : CLAUDE_MODELS;
  const cursor = useStore((s) => s.cursor);
  const place = useLayout((d) => d.chat);
  const box = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<{ x: number; y: number } | null>(null);
  const justMoved = useRef(false);

  /** Drag the chat by its title. Let go near a corner and it snaps there. Anywhere else, it stays put. */
  const grab = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".mode") || e.button !== 0) return;
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const b = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, ox: b.left - p.left, oy: b.top - p.top };
    let dragged = false;
    const at = (m: PointerEvent) => ({
      x: Math.max(0, Math.min(p.width - b.width, start.ox + m.clientX - start.px)),
      y: Math.max(0, Math.min(p.height - b.height, start.oy + m.clientY - start.py)),
    });
    const move = (m: PointerEvent) => {
      if (!dragged && Math.hypot(m.clientX - start.px, m.clientY - start.py) < 5) return;
      dragged = true;
      setMoving(at(m));
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged) return;
      justMoved.current = true;
      setTimeout(() => (justMoved.current = false), 0);
      const pos = at(m);
      const near = 110;
      const left = pos.x < near;
      const right = p.width - (pos.x + b.width) < near;
      const top = pos.y < near;
      const bottom = p.height - (pos.y + b.height) < near;
      setMoving(null);
      if ((left || right) && (top || bottom)) setLayout({ chat: { corner: `${top ? "t" : "b"}${left ? "l" : "r"}` as Corner } });
      else setLayout({ chat: { x: pos.x, y: pos.y } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, minimized]);

  const send = (t: string) => {
    if (!t.trim() || running) return;
    setText("");
    void sendToAgent(t);
  };

  return (
    <div
      ref={box}
      className={`chat ${minimized ? "min" : ""} ${moving ? "moving free" : "corner" in place ? `c-${place.corner}` : "free"}`}
      style={moving ? { left: moving.x, top: moving.y } : "x" in place ? { left: place.x, top: place.y } : undefined}
    >
      <div
        className="chead"
        onPointerDown={grab}
        title="Drag to move me. Let go near a corner and I will snap there."
        onClick={() => !justMoved.current && setMinimized(!minimized)}
      >
        <div className="av">D</div>
        <div className="ctitle">Duet</div>
        <div className="mode" onClick={(e) => e.stopPropagation()}>
          {MODES.map((m) => (
            <span key={m.mode} className={mode === m.mode ? "on" : ""} title={m.hint} onClick={() => setMode(m.mode)}>
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {!minimized && (
        <>
          <div className="tool-row">
            <span>AI tool</span>
            <select value={agent} disabled={running} onChange={(e) => setAgent(e.target.value as AgentId)}>
              {AGENTS.map((a) => {
                const here = installed[a.id];
                const label = !here ? `${a.name} (not found)` : !a.runnable ? `${a.name} (coming soon)` : a.name;
                return (
                  <option key={a.id} value={a.id} disabled={!a.runnable}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="tool-row">
            <span>Model</span>
            <select value={models[agent] ?? ""} disabled={running} onChange={(e) => setModel(agent, e.target.value)}>
              {modelList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select title="How hard it thinks. More effort takes longer and costs more." value={effort} disabled={running} onChange={(e) => setEffort(e.target.value)} style={{ flex: "none", width: 92 }}>
              {EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {x === "" ? "Effort" : x}
                </option>
              ))}
            </select>
          </div>
          <div className="mode-hint">{MODES.find((m) => m.mode === mode)?.hint}</div>
          <div className="cbody">
            {found === false && (
              <div className="m">
                Duet works with the AI tool you already use, so it costs nothing extra. I could not find{" "}
                {AGENTS.find((a) => a.id === agent)?.name} on this computer. Install it from {AGENTS.find((a) => a.id === agent)?.install},
                sign in once, then reopen Duet. Or pick another tool above.
              </div>
            )}
            {messages.length === 0 && found !== false && (
              <div className="m">Hi. Tell me what you want to do, or tap an idea. I can see what is selected on your canvas.</div>
            )}
            {messages.map((m) => {
              if (m.role === "working") return <div key={m.id} className="m working">{m.text}</div>;
              if (m.role === "you") return <div key={m.id} className="m you">{m.text}</div>;
              if (m.role === "error") return <div key={m.id} className="m err">{m.text}</div>;
              if (m.proposal)
                return (
                  <div key={m.id} className="m card">
                    <div className="tagline">Suggestion</div>
                    {m.proposal.summary}
                    <div className="act">
                      {m.proposal.status === "open" ? (
                        <>
                          <span onClick={() => applyProposal(m.id)}>Apply</span>
                          <span onClick={() => updateMsg(m.id, { proposal: { ...m.proposal!, status: "dismissed" } })}>Not now</span>
                        </>
                      ) : (
                        <em>{m.proposal.status === "applied" ? "Applied" : "Dismissed"}</em>
                      )}
                    </div>
                  </div>
                );
              if (m.approval)
                return (
                  <div key={m.id} className="m card warn">
                    <div className="tagline">Duet is asking</div>
                    {m.approval.summary}
                    <div className="act">
                      {m.approval.status === "waiting" ? (
                        <>
                          <span onClick={() => answerApproval(m.id, true)}>Allow</span>
                          <span onClick={() => answerApproval(m.id, false)}>Not now</span>
                        </>
                      ) : (
                        <em>{m.approval.status === "allowed" ? "Allowed" : "Not now"}</em>
                      )}
                    </div>
                  </div>
                );
              if (m.role === "note")
                return (
                  <div key={m.id} className="m note">
                    {m.text}
                    {m.undoStep !== undefined && !m.undone && cursor === m.undoStep && (
                      <span className="undo" onClick={() => undoAiStep(m.id)}>
                        Undo
                      </span>
                    )}
                    {m.undone && <em> Undone</em>}
                  </div>
                );
              return <div key={m.id} className="m">{m.text}</div>;
            })}
            <div ref={end} />
          </div>

          {messages.length === 0 && found !== false && (
            <div className="chips">
              {IDEAS.map((i) => (
                <span key={i} className="chip" onClick={() => send(i)}>
                  {i}
                </span>
              ))}
            </div>
          )}

          <div className="cfoot">
            <textarea
              value={text}
              rows={1}
              placeholder={found === false ? "Pick an AI tool that is installed" : "What do you want to change?"}
              disabled={found === false}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            {running ? (
              <button className="mini" onClick={stopAgent}>
                Stop
              </button>
            ) : (
              <button className="mini primary" disabled={!text.trim() || found === false} onClick={() => send(text)}>
                Send
              </button>
            )}
          </div>
          {messages.length > 0 && !running && (
            <div className="newchat" onClick={newConversation}>
              Start a fresh conversation
            </div>
          )}
        </>
      )}
    </div>
  );
}
