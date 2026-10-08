import { useEffect, useRef, useState } from "react";
import { sendToAgent, stopAgent } from "../ai/agent";
import { AGENTS, answerApproval, newConversation, setAgent, setMinimized, setMode, updateMsg, useChat } from "../ai/chat";
import type { AgentId } from "../ai/chat";
import type { Mode } from "../ai/chat";
import { applyProposal, undoAiStep } from "../ai/tools";
import { useStore } from "../state/store";

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
  const cursor = useStore((s) => s.cursor);
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
    <div className={`chat ${minimized ? "min" : ""}`}>
      <div className="chead" onClick={() => setMinimized(!minimized)}>
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
              placeholder={found === false ? "Pick an AI tool that is installed" : "Describe a change"}
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
