import { isOutside, plainName } from "../ai/who";
import { useEffect, useLayoutEffect, useRef, useState, Fragment } from "react";
import { sendToAgent, stopAgent } from "../ai/agent";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../project/project";
import { AGENTS, CLAUDE_MODELS, EFFORTS, answerApproval, removePicture, setEffort, setModel, newConversation, setAgent, setMinimized, setMode, updateMsg, useChat } from "../ai/chat";
import { attachFiles } from "../ai/pictures";
import type { ModelChoice, AgentId, Mode, Msg } from "../ai/chat";
import { applyProposal, undoAiStep } from "../ai/tools";
import { findStep } from "../memory/steps";
import { goTo, useStore } from "../state/store";
import ConnectAi from "./ConnectAi";
import Rich from "./rich";
import Icon from "./Icons";
import { CHAT_MAX, CHAT_MIN, setLayout, useLayout } from "./layout";
import type { Corner } from "./layout";
import { agentColour, whoColour } from "../ai/colours";
import { busyOutside } from "../ai/outside";
import { useDismiss } from "./useDismiss";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "suggest", label: "Suggest", hint: "Duet only suggests. Nothing changes until you tap Apply." },
  { mode: "ask", label: "Ask first", hint: "Duet makes design changes. It asks before deleting anything or bringing in a file." },
  { mode: "auto", label: "Auto", hint: "Duet does what you ask on its own. You can undo any step." },
];

const IDEAS = ["Describe this design", "Tidy the spacing", "Check text contrast"];

type ChatMessage = Msg;

type RenderItem =
  | { type: "single"; msg: ChatMessage }
  | { type: "noteGroup"; id: number; messages: ChatMessage[] };

function groupMessages(list: ChatMessage[]): RenderItem[] {
  const result: RenderItem[] = [];
  let currentNotes: ChatMessage[] = [];

  const flushNotes = () => {
    if (currentNotes.length === 1) {
      result.push({ type: "single", msg: currentNotes[0] });
    } else if (currentNotes.length > 1) {
      result.push({ type: "noteGroup", id: currentNotes[0].id, messages: currentNotes });
    }
    currentNotes = [];
  };

  for (const m of list) {
    if (m.role === "note") {
      currentNotes.push(m);
    } else {
      flushNotes();
      result.push({ type: "single", msg: m });
    }
  }
  flushNotes();

  return result;
}

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
  const pictures = useChat((s) => s.pictures);
  const cursor = useStore((s) => s.cursor);
  const timeline = useStore((s) => s.timeline);
  const place = useLayout((d) => d.chat);
  const chatW = useLayout((d) => d.chatW);
  const chatH = useLayout((d) => d.chatH);

  const [connecting, setConnecting] = useState(false);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const [agyModels, setAgyModels] = useState<ModelChoice[]>([]);
  const [sizing, setSizing] = useState<{ w: number; h: number } | null>(null);
  const [moving, setMoving] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const [room, setRoom] = useState<number | null>(null);
  const [busyName, setBusyName] = useState<string | null>(() => busyOutside());
  const [litStep, setLitStep] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [unfoldedGroups, setUnfoldedGroups] = useState<Record<number, boolean>>({});

  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const justMoved = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useDismiss(popOpen, () => setPopOpen(false), ".agent-pop, [data-name='agent-button']");

  useEffect(() => {
    if (minimized) setPopOpen(false);
  }, [minimized]);

  useEffect(() => {
    if (agent !== "agy" || agyModels.length || !inTauri()) return;
    invoke<ModelChoice[]>("agent_models", { program: "agy" })
      .then((list) => setAgyModels([{ id: "", name: "Default" }, ...list]))
      .catch(() => setAgyModels([{ id: "", name: "Default" }]));
  }, [agent, agyModels.length]);

  const dragging = moving !== null;
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent || minimized) return;
    const hangs = dragging || !("corner" in place) || place.corner.startsWith("t");
    const measure = () => {
      const body = list.current;
      if (!body) return;
      let rest = el.offsetHeight - el.clientHeight; // the border
      for (const c of Array.from(el.children) as HTMLElement[]) if (c !== body && !c.classList.contains("csize")) rest += c.offsetHeight;
      // hanging from the top it must stop above the bottom edge; sitting on the bottom it may reach up to the top
      const space = hangs ? parent.clientHeight - el.offsetTop - 16 : parent.clientHeight - 32;
      const next = Math.max(48, Math.floor(space - rest));
      setRoom((was) => (was === next ? was : next));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(parent);
    watch.observe(el);
    return () => watch.disconnect();
  }, [minimized, place, dragging, big]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = connecting ? 0 : list.current.scrollHeight;
  }, [messages, minimized, room, sizing, chatH, connecting, big]);

  useEffect(() => setConnecting(false), [messages.length]);

  useEffect(() => {
    const timer = setInterval(() => setBusyName(busyOutside()), 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onShowRequest = (ev: Event) => {
      const step = (ev as CustomEvent<string | undefined>).detail;
      if (!step) return;
      setMinimized(false);
      setLitStep(step);
      if (litTimer.current) clearTimeout(litTimer.current);
      litTimer.current = setTimeout(() => {
        setLitStep(null);
      }, 1500);
      const scrollAndLight = () => {
        const el = list.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.classList.add("lit");
          setTimeout(() => el.classList.remove("lit"), 1500);
        }
      };
      setTimeout(scrollAndLight, 50);
    };
    window.addEventListener("duet:show-request", onShowRequest);
    return () => {
      window.removeEventListener("duet:show-request", onShowRequest);
      if (litTimer.current) clearTimeout(litTimer.current);
    };
  }, []);

  const renderItems = groupMessages(messages);

  useEffect(() => {
    if (!litStep) return;
    setUnfoldedGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of renderItems) {
        if (item.type === "noteGroup" && item.messages.some((m) => m.step === litStep)) {
          if (!next[item.id]) {
            next[item.id] = true;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [litStep, renderItems]);

  const waiting = pictures.filter((p) => !p.sent);
  const attach = (files: File[]) => void attachFiles(files).then(setPictureNote);
  const modelList = agent === "agy" ? (agyModels.length ? agyModels : [{ id: "", name: "Default" }]) : CLAUDE_MODELS;

  const anchor = "corner" in place ? place.corner : "tl";
  const growX = anchor.endsWith("l") ? 1 : -1;
  const growY = anchor.startsWith("t") ? 1 : -1;

  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: chatW, h: chatH };
    const at = (m: PointerEvent) => ({
      w: Math.max(CHAT_MIN.w, Math.min(CHAT_MAX.w, start.w + (m.clientX - start.x) * growX)),
      h: Math.max(CHAT_MIN.h, Math.min(CHAT_MAX.h, start.h + (m.clientY - start.y) * growY)),
    });
    const move = (m: PointerEvent) => setSizing(at(m));
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = at(m);
      setSizing(null);
      setLayout({ chatW: next.w, chatH: next.h });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const w = sizing?.w ?? chatW;
  const h = sizing?.h ?? chatH;

  const grab = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".mode") || (e.target as Element).closest(".chat-expand-btn") || e.button !== 0) return;
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

  const chosenAgentObj = AGENTS.find((a) => a.id === agent);
  const toolName = chosenAgentObj?.name || "AI";
  const chatToolLetter = toolName.charAt(0);

  const outsideAgents: string[] = [];
  for (const e of timeline) {
    if (e.actor === "ai" && isOutside(e.by) && !outsideAgents.includes(plainName(e.by as string))) {
      outsideAgents.push(plainName(e.by as string));
    }
  }

  const send = (t: string) => {
    if ((!t.trim() && !waiting.length) || running) return;
    setText("");
    setPictureNote(null);
    void sendToAgent(t);
  };

  const renderNote = (m: ChatMessage) => {
    const isLater = m.undoStep !== undefined && m.undoStep > cursor;
    const isLit = litStep === m.step;
    const laterTitle = isLater ? "This comes after the moment you are looking at" : undefined;
    const noteStepIndex = findStep(timeline, m.step);
    const noteAgent = (m as any).by || (m as any).name || (noteStepIndex >= 0 ? timeline[noteStepIndex]?.by : undefined) || (m.undoStep !== undefined ? timeline[m.undoStep]?.by : undefined);
    const col = isOutside(noteAgent) ? agentColour(plainName(noteAgent)) : undefined;
    return (
      <div
        key={m.id}
        data-step={m.step}
        className={`m note ${noteAgent ? "outside-ai" : ""} ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
        title={laterTitle}
        style={col ? { color: col } : undefined}
      >
        {noteAgent && (
          <span className="m-badge" style={{ backgroundColor: col }}>
            {noteAgent.charAt(0)}
          </span>
        )}
        {noteAgent ? (
          <span className="m-body">
            {m.text}
            {m.undoStep !== undefined && !m.undone && cursor === m.undoStep && (
              <span className="undo" onClick={() => undoAiStep(m.id)}>
                Undo
              </span>
            )}
            {m.undone && <em> Undone</em>}
            {(() => {
              const at = findStep(timeline, m.step);
              return at >= 0 && at !== cursor && !m.undone ? (
                <span className="undo" title="Go to this moment in the history" onClick={() => goTo(at)}>
                  Show this step
                </span>
              ) : null;
            })()}
          </span>
        ) : (
          <>
            {m.text}
            {m.undoStep !== undefined && !m.undone && cursor === m.undoStep && (
              <span className="undo" onClick={() => undoAiStep(m.id)}>
                Undo
              </span>
            )}
            {m.undone && <em> Undone</em>}
            {(() => {
              const at = findStep(timeline, m.step);
              return at >= 0 && at !== cursor && !m.undone ? (
                <span className="undo" title="Go to this moment in the history" onClick={() => goTo(at)}>
                  Show this step
                </span>
              ) : null;
            })()}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={box}
      className={`chat ${big ? "big" : ""} ${minimized ? "min" : ""} ${moving ? "moving free" : "corner" in place ? `c-${place.corner}` : "free"}`}
      style={{
        ...(moving ? { left: moving.x, top: moving.y } : "x" in place ? { left: place.x, top: big ? Math.min(place.y, 16) : place.y } : {}),
        width: big ? 520 : w,
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        // a picture dropped on the chat is for the AI to look at; dropped on the canvas it joins the design
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setMinimized(false);
        attach(Array.from(e.dataTransfer.files));
      }}
    >
      <div
        className="chead"
        onPointerDown={grab}
        title="Drag to move me. Let go near a corner and I will snap there."
        onClick={() => !justMoved.current && setMinimized(!minimized)}
      >
        <div className="av">D</div>
        <div className="ctitle">Duet</div>
        <button
          type="button"
          className="chat-expand-btn"
          data-name="chat-expand"
          title={big ? "Make the chat smaller" : "Make the chat bigger"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (minimized) setMinimized(false);
            setBig((v) => !v);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {big ? (
              <>
                <path d="M4 9h3v3M12 7H9V4" />
                <path d="M7 9L2.5 13.5M9 7l4.5-4.5" />
              </>
            ) : (
              <>
                <path d="M10 2.5h3.5V6M6 13.5H2.5V10" />
                <path d="M13.5 2.5l-5 5M2.5 13.5l5-5" />
              </>
            )}
          </svg>
        </button>
      </div>

      {!minimized && (
        <>
          <div className={`csize ${growX > 0 ? "r" : "l"} ${growY > 0 ? "b" : "t"}`} onPointerDown={resize} title="Pull to make the chat bigger or smaller" />
          <div className="cbody" ref={list} style={{ maxHeight: big ? undefined : (room === null ? h : Math.min(h, room)) }}>
            {connecting && <ConnectAi />}
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
            {renderItems.map((item) => {
              if (item.type === "noteGroup") {
                const isGroupLit = item.messages.some((m) => litStep === m.step);
                const isGroupLater = item.messages.some((m) => m.undoStep !== undefined && m.undoStep > cursor);
                const isUnfolded = unfoldedGroups[item.id] ?? isGroupLit;
                const targetStep = item.messages.find((m) => m.step === litStep)?.step ?? item.messages[0].step;
                return (
                  <Fragment key={`group-${item.id}`}>
                    <div
                      data-step={targetStep}
                      className={`m note ${isGroupLater ? "later" : ""} ${isGroupLit ? "lit" : ""}`}
                      title={isGroupLater ? "This comes after the moment you are looking at" : undefined}
                    >
                      {item.messages.length} changes
                      <span
                        className="undo note-toggle"
                        onClick={() =>
                          setUnfoldedGroups((prev) => ({
                            ...prev,
                            [item.id]: !isUnfolded,
                          }))
                        }
                      >
                        {isUnfolded ? "Hide" : "Show"}
                      </span>
                    </div>
                    {isUnfolded && item.messages.map((m) => renderNote(m))}
                  </Fragment>
                );
              }

              const m = item.msg;
              const isLater = m.undoStep !== undefined && m.undoStep > cursor;
              const isLit = litStep === m.step;
              const laterTitle = isLater ? "This comes after the moment you are looking at" : undefined;

              if (m.role === "working")
                return (
                  <div
                    key={m.id}
                    data-step={m.step}
                    className={`m working ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={laterTitle}
                  >
                    {m.text}
                  </div>
                );
              if (m.role === "you")
                return (
                  <div
                    key={m.id}
                    data-step={m.step}
                    className={`m you ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={laterTitle}
                  >
                    {m.pictures && (
                      <div className="pics">
                        {m.pictures.map((n) => {
                          const p = pictures.find((x) => x.n === n);
                          return p ? <img key={n} src={p.thumb} alt={p.name} title={p.name} /> : <span key={n} className="pic-gone" title="This picture is no longer kept" />;
                        })}
                      </div>
                    )}
                    {m.text}
                  </div>
                );
              if (m.role === "error")
                return (
                  <div
                    key={m.id}
                    data-step={m.step}
                    className={`m err ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={laterTitle}
                  >
                    {m.text}
                  </div>
                );
              if (m.proposal)
                return (
                  <div
                    key={m.id}
                    data-step={m.step}
                    className={`m card ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={laterTitle}
                  >
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
                  <div
                    key={m.id}
                    data-step={m.step}
                    className={`m card warn ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={laterTitle}
                  >
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
              if (m.role === "note") {
                return renderNote(m);
              }
              return (
                <div
                  key={m.id}
                  data-step={m.step}
                  className={`m ai ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                  title={laterTitle}
                >
                  <span className="m-badge" style={{ backgroundColor: whoColour("ai") }}>
                    {chatToolLetter}
                  </span>
                  <div className="m-body">
                    <Rich text={m.text} />
                  </div>
                </div>
              );
            })}
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

          {(waiting.length > 0 || pictureNote) && (
            <div className="waiting">
              {waiting.map((p) => (
                <span key={p.n} className="pic" title={p.name}>
                  <img src={p.thumb} alt={p.name} />
                  <b onClick={() => removePicture(p.n)} title="Take this picture out">
                    ×
                  </b>
                </span>
              ))}
              {pictureNote && <em>{pictureNote}</em>}
            </div>
          )}
          <div className="cfoot">
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                attach(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div className="agent-anchor">
              <button
                type="button"
                className="agent-btn"
                data-name="agent-button"
                title="Who answers, and how"
                onClick={() => setPopOpen((o) => !o)}
              >
                <span className="agent-btn-badge">{chatToolLetter}</span>
                <span className="agent-btn-name">{toolName}</span>
                <span className="agent-btn-v">v</span>
              </button>
              <span className={`agent-perm ${mode === "auto" ? "auto" : ""}`}>
                {MODES.find((m) => m.mode === mode)?.label}
              </span>
              {popOpen && (
                <div className="agent-pop">
                  <div>
                    <div className="agent-pop-label">Who answers</div>
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
                  <div className="agent-pop-row">
                    <div>
                      <div className="agent-pop-label">Model</div>
                      <select value={models[agent] ?? ""} disabled={running} onChange={(e) => setModel(agent, e.target.value)}>
                        {modelList.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {agent === "claude" && (
                      <div>
                        <div className="agent-pop-label">Effort</div>
                        <select title="How hard it thinks. More effort takes longer and costs more." value={effort} disabled={running} onChange={(e) => setEffort(e.target.value)}>
                          {EFFORTS.map((x) => (
                            <option key={x} value={x}>
                              {x === "" ? "Effort" : x}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="agent-pop-label">How much it may do</div>
                    <div className="mode">
                      {MODES.map((m) => (
                        <span key={m.mode} className={mode === m.mode ? "on" : ""} title={m.hint} onClick={() => setMode(m.mode)}>
                          {m.label}
                        </span>
                      ))}
                    </div>
                    <div className="mode-hint" style={{ padding: "6px 0 0" }}>
                      {MODES.find((m) => m.mode === mode)?.hint}
                    </div>
                  </div>
                  <div className="agent-pop-divider" />
                  <div>
                    <div className="agent-pop-label">Others on this design</div>
                    {outsideAgents.length === 0 ? (
                      <div className="agent-pop-empty">No one else right now.</div>
                    ) : (
                      <div className="agent-pop-chips">
                        {outsideAgents.map((by) => {
                          const col = agentColour(by);
                          const isWorking = busyName === by;
                          return (
                            <div
                              key={by}
                              className={`agent-chip outside ${isWorking ? "working" : ""}`}
                              title="Works from its own window. It cannot be asked from here."
                            >
                              <span className="agent-chip-badge" style={{ backgroundColor: col }}>
                                {by.charAt(0)}
                              </span>
                              <span className="agent-chip-name">{by}</span>
                              <span className="agent-chip-status">
                                {isWorking && <span className="agent-chip-dot" style={{ backgroundColor: col }} />}
                                {isWorking ? "working" : "outside"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="agent-pop-divider" />
                  <div className="agent-pop-links">
                    <div
                      className="agent-pop-link connect-link"
                      onClick={() => {
                        setConnecting((c) => !c);
                        setPopOpen(false);
                      }}
                    >
                      Connect your own AI
                    </div>
                    <div
                      className={`agent-pop-link newchat ${messages.length === 0 || running ? "disabled" : ""}`}
                      onClick={() => {
                        if (messages.length === 0 || running) return;
                        newConversation();
                        setPopOpen(false);
                      }}
                    >
                      Start a fresh conversation
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button className="mini attach" disabled={found === false} title="Add pictures for the AI to look at. You can also paste or drop them here." onClick={() => picker.current?.click()}>
              <Icon name="image" size={16} />
            </button>
            <textarea
              value={text}
              rows={1}
              placeholder={found === false ? "Pick an AI tool that is installed" : `Ask ${toolName}`}
              disabled={found === false}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (!files.length) return;
                e.preventDefault();
                attach(files);
              }}
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
              <button className="mini primary" disabled={(!text.trim() && !waiting.length) || found === false} onClick={() => send(text)}>
                Send
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
