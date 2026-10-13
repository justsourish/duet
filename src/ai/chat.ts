import { useSyncExternalStore } from "react";

export type Mode = "suggest" | "ask" | "auto";

export interface Proposal {
  tool: string;
  args: unknown;
  summary: string;
  status: "open" | "applied" | "dismissed";
  /** The AI tool that suggested it, when it said who it is. */
  by?: string;
}

export interface Approval {
  summary: string;
  status: "waiting" | "allowed" | "declined";
}

export interface Msg {
  id: number;
  role: "you" | "duet" | "note" | "error" | "working" | "break";
  text: string;
  /** Milliseconds since 1970, when it was said. */
  time?: number;
  proposal?: Proposal;
  approval?: Approval;
  /** The numbers of the pictures that went with this message. */
  pictures?: number[];
  /** History step this change created, so Undo can take it back. */
  undoStep?: number;
  undone?: boolean;
  /** The name of the history step this change created. Unlike undoStep, it still means the same step after the project is opened again. */
  step?: string;
  /** For what an AI said: the name of the agent that said it, so a chat with several agents shows who spoke. */
  by?: string;
}

/**
 * Who a message is meant for, when it names an agent with @. "@antigravity tidy this" and
 * "@Claude Code look" both work: the name may be shortened and may hold a space.
 */
export function mentioned(text: string, installed: Partial<Record<AgentId, boolean>>): AgentId | null {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const m of text.matchAll(/@([A-Za-z][A-Za-z0-9]*(?: [A-Za-z][A-Za-z0-9]*)?)/g)) {
    const words = m[1].split(" ");
    for (const said of [flat(m[1]), flat(words[0])]) {
      if (said.length < 3) continue;
      const hit = AGENTS.find((a) => a.runnable && installed[a.id] && (flat(a.name).startsWith(said) || a.id === said));
      if (hit) return hit.id;
    }
  }
  return null;
}

/** A picture the designer gave the AI with a message. It is never part of the design. */
export interface Picture {
  /** The number the AI asks for it by. Counts up through the conversation. */
  n: number;
  name: string;
  /** Shrunk, as base64. */
  data: string;
  mime: string;
  width: number;
  height: number;
  /** A tiny copy to show in the chat. */
  thumb: string;
  /** False while it waits in the message box. */
  sent: boolean;
}

export type AgentId = "claude" | "agy" | "codex" | "opencode";

/** Every tool Duet looks for. Only some can be driven so far. */
export const AGENTS: { id: AgentId; name: string; runnable: boolean; install: string }[] = [
  { id: "claude", name: "Claude Code", runnable: true, install: "https://claude.com/claude-code" },
  { id: "agy", name: "Antigravity", runnable: true, install: "https://antigravity.google" },
  { id: "codex", name: "Codex", runnable: false, install: "" },
  { id: "opencode", name: "OpenCode", runnable: false, install: "" },
];

export interface ChatState {
  agent: AgentId;
  installed: Partial<Record<AgentId, boolean>>;
  messages: Msg[];
  /** Conversations closed with "Start a fresh conversation". Not shown, but the project keeps them. */
  earlier: Msg[];
  pictures: Picture[];
  mode: Mode;
  running: boolean;
  minimized: boolean;
  /** null while we are still looking */
  agentFound: boolean | null;
  sessionId: string | null;
  /** When the AI tool's own session was last used, and how many messages it has taken. */
  sessionUsed: number;
  sessionMessages: number;
  /** The model chosen for each tool. Empty means the tool's own default. */
  models: Partial<Record<AgentId, string>>;
  effort: string;
}

export interface ModelChoice {
  id: string;
  name: string;
}

/** Models Duet knows without asking. Antigravity lists its own. */
export const CLAUDE_MODELS: ModelChoice[] = [
  { id: "", name: "Default" },
  { id: "sonnet", name: "Sonnet (quick)" },
  { id: "opus", name: "Opus (careful)" },
  { id: "haiku", name: "Haiku (fastest)" },
];
export const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

const pick = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

const MODE_KEY = "duet:ai-mode";
const AGENT_KEY = "duet:ai-tool";

function savedAgent(): AgentId {
  try {
    const a = localStorage.getItem(AGENT_KEY);
    if (AGENTS.some((x) => x.id === a && x.runnable)) return a as AgentId;
  } catch {
    /* ignore */
  }
  return "claude";
}

function savedMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "suggest" || m === "ask" || m === "auto") return m;
  } catch {
    /* ignore */
  }
  return "ask";
}

let state: ChatState = {
  agent: savedAgent(),
  installed: {},
  messages: [],
  earlier: [],
  pictures: [],
  mode: savedMode(),
  running: false,
  minimized: false,
  agentFound: null,
  sessionId: null,
  sessionUsed: 0,
  sessionMessages: 0,
  models: { claude: pick("duet:model:claude"), agy: pick("duet:model:agy") },
  effort: pick("duet:effort"),
};
let nextId = 1;
let nextPicture = 1;
/** Older pictures are let go, so a long conversation does not fill the memory. */
const PICTURES_KEPT = 30;
const listeners = new Set<() => void>();
const pendingApprovals = new Map<number, (allowed: boolean) => void>();

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getChat = () => state;
export const subscribeChat = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export function useChat<T>(selector: (s: ChatState) => T): T {
  return useSyncExternalStore(subscribeChat, () => selector(state));
}

export function addMsg(m: Omit<Msg, "id">): number {
  const id = nextId++;
  set({ messages: [...state.messages, { time: Date.now(), ...m, id }] });
  return id;
}

export function updateMsg(id: number, patch: Partial<Msg>) {
  set({ messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

/** Keep pictures waiting in the message box, to go with the next message. */
export function addPictures(list: Omit<Picture, "n" | "sent">[]) {
  if (!list.length) return;
  const all = [...state.pictures, ...list.map((p) => ({ ...p, n: nextPicture++, sent: false }))];
  set({ pictures: all.slice(-PICTURES_KEPT) });
}

/** Take a waiting picture out again, before it is sent. */
export function removePicture(n: number) {
  set({ pictures: state.pictures.filter((p) => p.n !== n || p.sent) });
}

/** The waiting pictures go with the message being sent. Returns them. */
export function sendPictures(): Picture[] {
  const going = state.pictures.filter((p) => !p.sent);
  if (going.length) set({ pictures: state.pictures.map((p) => (p.sent ? p : { ...p, sent: true })) });
  return going;
}

export function removeWorking() {
  set({ messages: state.messages.filter((m) => m.role !== "working") });
}

export function setMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  set({ mode });
}

export const setRunning = (running: boolean) => set({ running });
export const setMinimized = (minimized: boolean) => set({ minimized });
export const setAgentFound = (agentFound: boolean) => set({ agentFound });

/** Remember which tools are installed, and whether the chosen one is ready. */
export function setInstalled(installed: Partial<Record<AgentId, boolean>>) {
  set({ installed, agentFound: installed[state.agent] ?? false });
}

/** Switch to another AI tool. The conversation stays: Duet holds it, and hands the new tool a note of it. */
export function setAgent(agent: AgentId) {
  try {
    localStorage.setItem(AGENT_KEY, agent);
  } catch {
    /* ignore */
  }
  declineAllWaiting();
  for (const k of kept.values()) k.sessionId = null;
  set({ agent, agentFound: state.installed[agent] ?? false, sessionId: null });
}
export function setModel(agent: AgentId, model: string) {
  try {
    localStorage.setItem(`duet:model:${agent}`, model);
  } catch {
    /* ignore */
  }
  for (const k of kept.values()) k.sessionId = null;
  set({ models: { ...state.models, [agent]: model }, sessionId: null });
}

export function setEffort(effort: string) {
  try {
    localStorage.setItem("duet:effort", effort);
  } catch {
    /* ignore */
  }
  set({ effort });
}

export const setSessionId = (sessionId: string | null) => set({ sessionId });

/** The AI tool starts fresh on the next message, instead of carrying its own session on. */
export const dropSession = () => set({ sessionId: null, sessionMessages: 0 });
/** A message went into the AI tool's session, or it has just finished answering. */
export const sessionUsed = (message = false) => set({ sessionUsed: Date.now(), sessionMessages: state.sessionMessages + (message ? 1 : 0) });

/** Start a fresh conversation. The one before is not shown any more, but the project keeps it. */
export function newConversation() {
  declineAllWaiting();
  const closed = state.messages.filter((m) => m.role !== "working");
  const earlier = closed.length ? [...state.earlier, ...closed, { id: nextId++, role: "break" as const, text: "", time: Date.now() }] : state.earlier;
  set({ messages: [], earlier, pictures: state.pictures.filter((p) => !p.sent), sessionId: null, sessionMessages: 0 });
}

/** A conversation put away while another project is open. */
interface Kept {
  messages: Msg[];
  earlier: Msg[];
  pictures: Picture[];
  sessionId: string | null;
  sessionUsed: number;
  sessionMessages: number;
}

/** Conversations of the projects opened earlier, by project file. Kept while Duet is open. */
const kept = new Map<string, Kept>();
/** The project file the conversation on show belongs to. Empty for work that has no file yet. */
let shownFor = "";

/**
 * A conversation belongs to a project. Opening another project puts this one away and brings
 * that project's own conversation back, so the AI never talks about the design you just left.
 * A brand new project always starts with an empty one.
 */
export function showConversationFor(project: string, fresh = false) {
  if (project === shownFor && !fresh) return;
  declineAllWaiting();
  // work without a file is gone once another project opens, and so is its conversation
  if (shownFor && project !== shownFor) {
    kept.set(shownFor, {
      // a step in the history is not the same step after the project is opened again, so Undo is not offered
      messages: state.messages.filter((m) => m.role !== "working").map((m) => (m.undoStep === undefined ? m : { ...m, undoStep: undefined })),
      // pictures still waiting in the message box do not come along
      earlier: state.earlier,
      pictures: state.pictures.filter((p) => p.sent),
      sessionId: state.sessionId,
      sessionUsed: state.sessionUsed,
      sessionMessages: state.sessionMessages,
    });
  }
  const back = fresh ? undefined : kept.get(project);
  kept.delete(project);
  shownFor = project;
  set({
    messages: back?.messages ?? [],
    earlier: back?.earlier ?? [],
    pictures: back?.pictures ?? [],
    sessionId: back?.sessionId ?? null,
    sessionUsed: back?.sessionUsed ?? 0,
    sessionMessages: back?.sessionMessages ?? 0,
    running: false,
  });
}

/** The project file the conversation on show belongs to. Empty for work that has no file yet. */
export const conversationProject = () => shownFor;

/**
 * Put back a conversation that was saved with its project, when Duet has just opened it and has
 * nothing of its own to show. The AI tool's own session is long gone, so it starts fresh.
 */
export function restoreConversation(now: Omit<Msg, "id">[], earlier: Omit<Msg, "id">[]) {
  if (state.messages.length || state.earlier.length) return;
  if (!now.length && !earlier.length) return;
  const number = (list: Omit<Msg, "id">[]) => list.map((m) => ({ ...m, id: nextId++ }));
  // pictures are not kept, and a new one must not take the number of one that is gone
  for (const m of [...now, ...earlier]) for (const n of m.pictures ?? []) nextPicture = Math.max(nextPicture, n + 1);
  set({ messages: number(now), earlier: number(earlier), sessionId: null, sessionUsed: 0, sessionMessages: 0 });
}

/** Save As: the conversation stays with the work and goes to its new file. */
export function moveConversationTo(project: string) {
  kept.delete(project);
  shownFor = project;
}

/** Ask the designer a yes or no question and wait for the answer. */
export function askDesigner(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = addMsg({ role: "note", text: "", approval: { summary, status: "waiting" } });
    // an AI working from outside may ask while the chat is folded away
    set({ minimized: false });
    pendingApprovals.set(id, (allowed) => {
      updateMsg(id, { approval: { summary, status: allowed ? "allowed" : "declined" } });
      resolve(allowed);
    });
  });
}

export function answerApproval(id: number, allowed: boolean) {
  const fn = pendingApprovals.get(id);
  pendingApprovals.delete(id);
  fn?.(allowed);
}

/** If the agent stops, nobody should be left waiting. */
export function declineAllWaiting() {
  for (const [id, fn] of [...pendingApprovals]) {
    pendingApprovals.delete(id);
    fn(false);
  }
}
