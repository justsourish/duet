import { isOutside, plainName } from "../ai/who";
import { useEffect, useLayoutEffect, useRef, useState, Fragment } from "react";
import { sendToAgent, stopAgent } from "../ai/agent";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../project/project";
import { AGENTS, CLAUDE_MODELS, EFFORTS, answerApproval, removePicture, setEffort, setModel, newConversation, setAgent, setMinimized, setMode, updateMsg, useChat } from "../ai/chat";
import { attachFiles } from "../ai/pictures";
import type { ModelChoice, Mode, Msg } from "../ai/chat";
import { applyProposal, undoAiStep } from "../ai/tools";
import { findStep } from "../memory/steps";
import { goTo, useStore } from "../state/store";
import ConnectAi from "./ConnectAi";
import Rich from "./rich";
import Icon from "./Icons";
import { CHAT_MAX, CHAT_MIN, setLayout, useLayout } from "./layout";
import type { Corner } from "./layout";
import { agentColour } from "../ai/colours";
import { busyOutside } from "../ai/outside";
import { useDismiss } from "./useDismiss";
import { toggleSkill, useSkills } from "../ai/skills";

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

function renderYouText(content: string, membersList: { name: string }[]) {
  const parts = content.split(/(@[A-Za-z0-9_-]+)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("@") && part.length > 1) {
      const word = part.slice(1).toLowerCase();
      const hit =
        membersList.find((m) => {
          const flat = m.name.replace(/\s+/g, "").toLowerCase();
          return flat.startsWith(word);
        }) ??
        AGENTS.find((a) => {
          const flat = a.name.replace(/\s+/g, "").toLowerCase();
          return flat.startsWith(word);
        });
      if (hit) {
        return (
          <span key={idx} style={{ color: agentColour(hit.name), fontWeight: "bold" }}>
            {part}
          </span>
        );
      }
    }
    return part;
  });
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
  const skills = useSkills();

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

  const [cardAgent, setCardAgent] = useState<
    | { type: "member"; agent: (typeof AGENTS)[number] }
    | { type: "outside"; name: string }
    | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mentionHidden, setMentionHidden] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);

  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const justMoved = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useDismiss(popOpen, () => setPopOpen(false), ".agent-pop, [data-name='agent-button']");
  useDismiss(Boolean(cardAgent), () => setCardAgent(null), ".agent-card, [data-name='members']");
  useDismiss(settingsOpen, () => setSettingsOpen(false), ".chat-settings, [data-name='chat-settings']");

  useEffect(() => {
    if (minimized) {
      setPopOpen(false);
      setCardAgent(null);
      setSettingsOpen(false);
    }
  }, [minimized]);

  useEffect(() => {
    const needAgy = agent === "agy" || (cardAgent?.type === "member" && cardAgent.agent.id === "agy");
    if (!needAgy || agyModels.length || !inTauri()) return;
    invoke<ModelChoice[]>("agent_models", { program: "agy" })
      .then((list) => setAgyModels([{ id: "", name: "Default" }, ...list]))
      .catch(() => setAgyModels([{ id: "", name: "Default" }]));
  }, [agent, cardAgent, agyModels.length]);

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

  const members = AGENTS.filter((a) => a.runnable && Boolean(installed[a.id]));

  const joinedLines = outsideAgents.map((name) => {
    const firstStep = timeline.find(
      (e) => e.actor === "ai" && isOutside(e.by) && plainName(e.by as string) === name
    );
    return {
      type: "joined" as const,
      name,
      time: firstStep?.time ?? 0,
      text: `${name} joined from its own window`,
    };
  });

  type RenderEntry =
    | RenderItem
    | { type: "joined"; name: string; time: number; text: string };

  const getItemTime = (item: RenderEntry): number => {
    if (item.type === "joined") return item.time;
    if (item.type === "single") return item.msg.time ?? 0;
    return item.messages[0]?.time ?? 0;
  };

  const sortedJoined = [...joinedLines].sort((a, b) => a.time - b.time);
  const conversationItems: RenderEntry[] = [];
  let jIdx = 0;
  for (const r of renderItems) {
    const rTime = getItemTime(r);
    while (jIdx < sortedJoined.length && sortedJoined[jIdx].time <= rTime) {
      conversationItems.push(sortedJoined[jIdx]);
      jIdx++;
    }
    conversationItems.push(r);
  }
  while (jIdx < sortedJoined.length) {
    conversationItems.push(sortedJoined[jIdx]);
    jIdx++;
  }

  const mentionMatch = text.match(/@([A-Za-z]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const matchingMembers = mentionQuery !== null
    ? members.filter((m) => m.name.toLowerCase().startsWith(mentionQuery))
    : [];
  const showMentions = !mentionHidden && mentionMatch !== null && matchingMembers.length > 0;
  const activeMentionIdx = Math.min(mentionIndex, Math.max(0, matchingMembers.length - 1));

  const insertMention = (m: (typeof AGENTS)[number]) => {
    const replacement = "@" + m.name.replace(/\s+/g, "") + " ";
    const next = text.replace(/@[A-Za-z]*$/, replacement);
    setText(next);
    setMentionHidden(false);
    setMentionIndex(0);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = next.length;
      }
    }, 0);
  };

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
        <div className="ctitle">
          <b>Chat</b>
        </div>
        <div
          className="members-cluster"
          data-name="members"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {members.map((m) => {
            const isAnswers = m.id === agent;
            return (
              <div
                key={m.id}
                className={`member-badge ${isAnswers ? "answers-ring" : ""}`}
                style={{ backgroundColor: agentColour(m.name) }}
                title={m.name}
                onClick={(e) => {
                  e.stopPropagation();
                  if (minimized) setMinimized(false);
                  setCardAgent({ type: "member", agent: m });
                  setSettingsOpen(false);
                }}
              >
                {m.name.charAt(0)}
              </div>
            );
          })}
          {outsideAgents.map((name) => (
            <div
              key={name}
              className="member-badge outside"
              style={{ backgroundColor: agentColour(name) }}
              title={name}
              onClick={(e) => {
                e.stopPropagation();
                if (minimized) setMinimized(false);
                setCardAgent({ type: "outside", name });
                setSettingsOpen(false);
              }}
            >
              {name.charAt(0)}
            </div>
          ))}

          {!cardAgent && !settingsOpen && (
            <div className="members-list">
              {members.map((m) => {
                const isAnswers = m.id === agent;
                return (
                  <div
                    key={m.id}
                    className="members-list-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (minimized) setMinimized(false);
                      setCardAgent({ type: "member", agent: m });
                    }}
                  >
                    <span
                      className={`member-badge ${isAnswers ? "answers-ring" : ""}`}
                      style={{ backgroundColor: agentColour(m.name) }}
                    >
                      {m.name.charAt(0)}
                    </span>
                    <span className="members-list-name">{m.name}</span>
                    <span className="members-list-status">{isAnswers ? "answers" : "here"}</span>
                  </div>
                );
              })}
              {outsideAgents.map((name) => {
                const isWorking = busyName === name;
                return (
                  <div
                    key={name}
                    className="members-list-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (minimized) setMinimized(false);
                      setCardAgent({ type: "outside", name });
                    }}
                  >
                    <span
                      className="member-badge outside"
                      style={{ backgroundColor: agentColour(name) }}
                    >
                      {name.charAt(0)}
                    </span>
                    <span className="members-list-name">{name}</span>
                    <span className="members-list-status">{isWorking ? "working" : "outside"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          className="chat-settings-btn"
          data-name="chat-settings"
          title="Chat settings"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (minimized) setMinimized(false);
            setSettingsOpen((o) => !o);
            setCardAgent(null);
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>

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

        {cardAgent && (
          <div
            className="agent-card"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {cardAgent.type === "member" ? (
              <>
                <div className="agent-card-head">
                  <span
                    className="agent-card-badge"
                    style={{ backgroundColor: agentColour(cardAgent.agent.name) }}
                  >
                    {cardAgent.agent.name.charAt(0)}
                  </span>
                  <div className="agent-card-info">
                    <div className="agent-card-name">{cardAgent.agent.name}</div>
                    <div className="agent-card-status">
                      {cardAgent.agent.id === agent ? "answers" : "here"}
                    </div>
                  </div>
                </div>
                <div className="agent-pop-row">
                  <div>
                    <div className="agent-pop-label">Model</div>
                    <select
                      value={models[cardAgent.agent.id] ?? ""}
                      disabled={running}
                      onChange={(e) => setModel(cardAgent.agent.id, e.target.value)}
                    >
                      {(cardAgent.agent.id === "agy" ? (agyModels.length ? agyModels : [{ id: "", name: "Default" }]) : CLAUDE_MODELS).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {cardAgent.agent.id === "claude" && (
                    <div>
                      <div className="agent-pop-label">Effort</div>
                      <select
                        title="How hard it thinks. More effort takes longer and costs more."
                        value={effort}
                        disabled={running}
                        onChange={(e) => setEffort(e.target.value)}
                      >
                        {EFFORTS.map((x) => (
                          <option key={x} value={x}>
                            {x === "" ? "Effort" : x}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                {cardAgent.agent.id !== agent && (
                  <button
                    type="button"
                    className="make-answer-btn"
                    disabled={running}
                    onClick={() => {
                      setAgent(cardAgent.agent.id);
                    }}
                  >
                    Make this one answer
                  </button>
                )}
                <div className="agent-card-quiet">
                  {"Or write @" + cardAgent.agent.name + " in a message."}
                </div>
              </>
            ) : (
              <>
                <div className="agent-card-head">
                  <span
                    className="agent-card-badge outside"
                    style={{ backgroundColor: agentColour(cardAgent.name) }}
                  >
                    {cardAgent.name.charAt(0)}
                  </span>
                  <div className="agent-card-info">
                    <div className="agent-card-name">{cardAgent.name}</div>
                    <div className="agent-card-status">
                      {busyName === cardAgent.name ? "working" : "outside"}
                    </div>
                  </div>
                </div>
                <div className="agent-card-quiet">
                  Works from its own window. It cannot be asked from here.
                </div>
              </>
            )}
          </div>
        )}

        {settingsOpen && (
          <div
            className="chat-settings"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chat-settings-section">
              <div className="agent-pop-label">How much agents may do</div>
              <div className="mode">
                {MODES.map((m) => (
                  <span
                    key={m.mode}
                    className={mode === m.mode ? "on" : ""}
                    title={m.hint}
                    onClick={() => setMode(m.mode)}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="mode-hint" style={{ padding: "6px 0 0" }}>
                {MODES.find((m) => m.mode === mode)?.hint}
              </div>
            </div>

            <div className="chat-settings-section">
              <div className="agent-pop-label">Members</div>
              <div className="chat-settings-members-list">
                {members.map((m) => {
                  const isAnswers = m.id === agent;
                  return (
                    <div key={m.id} className="members-list-item">
                      <span
                        className={`member-badge ${isAnswers ? "answers-ring" : ""}`}
                        style={{ backgroundColor: agentColour(m.name) }}
                      >
                        {m.name.charAt(0)}
                      </span>
                      <span className="members-list-name">{m.name}</span>
                      <span className="members-list-status">
                        {isAnswers ? "answers" : "here"}
                      </span>
                    </div>
                  );
                })}
                {outsideAgents.map((name) => {
                  const isWorking = busyName === name;
                  return (
                    <div key={name} className="members-list-item">
                      <span
                        className="member-badge outside"
                        style={{ backgroundColor: agentColour(name) }}
                      >
                        {name.charAt(0)}
                      </span>
                      <span className="members-list-name">{name}</span>
                      <span className="members-list-status">
                        {isWorking ? "working" : "outside"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                className="agent-pop-link connect-link"
                style={{ marginTop: 6 }}
                onClick={() => {
                  setConnecting((c) => !c);
                  setSettingsOpen(false);
                }}
              >
                Connect your own AI
              </div>
            </div>

            <div className="chat-settings-section">
              <div className="agent-pop-label">Skills</div>
              <div className="chat-settings-skills">
                {skills.map((s) => (
                  <div className="skill" key={s.id}>
                    <div className="n">
                      {s.name}
                      <small>{s.summary}</small>
                    </div>
                    <div
                      className={`sw ${s.enabled ? "on" : ""}`}
                      onClick={() => toggleSkill(s.id)}
                      role="switch"
                      aria-checked={s.enabled}
                    />
                  </div>
                ))}
              </div>
              <div
                className={`agent-pop-link newchat ${messages.length === 0 || running ? "disabled" : ""}`}
                style={{ marginTop: 6 }}
                onClick={() => {
                  if (messages.length === 0 || running) return;
                  newConversation();
                  setSettingsOpen(false);
                }}
              >
                Start a fresh conversation
              </div>
            </div>
          </div>
        )}
      </div>

      {!minimized && (
        <>
          <div className={`csize ${growX > 0 ? "r" : "l"} ${growY > 0 ? "b" : "t"}`} onPointerDown={resize} title="Pull to make the chat bigger or smaller" />
          <div className="cbody" ref={list} style={{ height: big ? undefined : (room === null ? h : Math.min(h, room)) }}>
            {connecting && <ConnectAi />}
            {found === false && (
              <div className="m">
                Duet works with the AI tool you already use, so it costs nothing extra. I could not find{" "}
                {AGENTS.find((a) => a.id === agent)?.name} on this computer. Install it from {AGENTS.find((a) => a.id === agent)?.install},
                sign in once, then reopen Duet. Or pick another tool above.
              </div>
            )}
            {messages.length === 0 && found !== false && (
              <div className="m greeting">
                <span className="member-badge" style={{ backgroundColor: agentColour(toolName) }}>
                  {chatToolLetter}
                </span>
                Hey, {toolName} here. Tell me what to make or change. I can see what is selected on your canvas.
              </div>
            )}
            {conversationItems.map((item) => {
              if (item.type === "joined") {
                return (
                  <div key={`joined-${item.name}`} className="chat-joined-line">
                    {item.text}
                  </div>
                );
              }
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
                          if (p && p.text !== undefined) return <span key={n} className="pic-text" title={p.name}>{p.name}</span>;
                          return p ? <img key={n} src={p.thumb} alt={p.name} title={p.name} /> : <span key={n} className="pic-gone" title="This picture is no longer kept" />;
                        })}
                      </div>
                    )}
                    {renderYouText(m.text, members)}
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
              const authorName = m.by || toolName;
              return (
                <div
                  key={m.id}
                  data-step={m.step}
                  className={`m ai ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                  title={laterTitle}
                >
                  <div className="m-author">
                    <span className="m-badge" style={{ backgroundColor: agentColour(authorName) }}>
                      {authorName.charAt(0)}
                    </span>
                    <span className="m-author-name">{authorName}</span>
                  </div>
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
                  {p.text !== undefined ? <span className="pic-text">{p.name}</span> : <img src={p.thumb} alt={p.name} />}
                  <b onClick={() => removePicture(p.n)} title="Take this out">
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
              accept="image/*,.md,.markdown,.txt,text/plain,text/markdown"
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
                <span className="agent-btn-badge" style={{ backgroundColor: agentColour(toolName) }}>{chatToolLetter}</span>
                <span className="agent-btn-name">{toolName}</span>
                <span className="agent-btn-v">v</span>
              </button>
              <button
                type="button"
                data-name="perm-button"
                className={`agent-perm ${mode === "auto" ? "auto" : ""}`}
                title="How much agents may do. Click to change: Suggest, Ask first, Auto."
                onClick={() => setMode(mode === "suggest" ? "ask" : mode === "ask" ? "auto" : "suggest")}
              >
                {MODES.find((m) => m.mode === mode)?.label}
              </button>
              {popOpen && (
                <div className="agent-pop">
                  <div>
                    <div className="agent-pop-label">Who answers</div>
                    <div className="who-answers-list">
                      {members.map((m) => (
                        <div
                          key={m.id}
                          className={`who-answer-row ${m.id === agent ? "active" : ""}`}
                          onClick={() => {
                            if (running) return;
                            setAgent(m.id);
                            setPopOpen(false);
                          }}
                        >
                          <span
                            className="member-badge"
                            style={{ backgroundColor: agentColour(m.name) }}
                          >
                            {m.name.charAt(0)}
                          </span>
                          <span className="who-answer-name">{m.name}</span>
                          {m.id === agent && <span className="who-answer-status">answers</span>}
                        </div>
                      ))}
                      {members.length === 0 && (
                        <div className="agent-pop-empty">No members installed.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button className="mini attach" disabled={found === false} title="Add pictures or a written brief for the AI to look at. You can also paste or drop them here." onClick={() => picker.current?.click()}>
              <Icon name="image" size={16} />
            </button>
            {showMentions && (
              <div className="mention-list">
                {matchingMembers.map((m, idx) => (
                  <div
                    key={m.id}
                    className={`mention-item ${idx === activeMentionIdx ? "selected" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(m);
                    }}
                  >
                    <span
                      className="member-badge"
                      style={{ backgroundColor: agentColour(m.name) }}
                    >
                      {m.name.charAt(0)}
                    </span>
                    <span>{m.name}</span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              rows={1}
              placeholder={found === false ? "Pick an AI tool that is installed" : `Ask ${toolName}`}
              disabled={found === false}
              onChange={(e) => {
                setText(e.target.value);
                setMentionHidden(false);
                setMentionIndex(0);
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (!files.length) return;
                e.preventDefault();
                attach(files);
              }}
              onKeyDown={(e) => {
                if (showMentions) {
                  if (e.key === "Tab" || e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    const chosen = matchingMembers[activeMentionIdx] ?? matchingMembers[0];
                    if (chosen) insertMention(chosen);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setMentionHidden(true);
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % matchingMembers.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + matchingMembers.length) % matchingMembers.length);
                    return;
                  }
                }
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
