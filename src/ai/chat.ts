import { useSyncExternalStore } from "react";

export type Mode = "suggest" | "ask" | "auto";

export interface Proposal {
  tool: string;
  args: unknown;
  summary: string;
  status: "open" | "applied" | "dismissed";
}

export interface Approval {
  summary: string;
  status: "waiting" | "allowed" | "declined";
}

export interface Msg {
  id: number;
  role: "you" | "duet" | "note" | "error" | "working";
  text: string;
  proposal?: Proposal;
  approval?: Approval;
  /** The numbers of the pictures that went with this message. */
  pictures?: number[];
  /** History step this change created, so Undo can take it back. */
  undoStep?: number;
  undone?: boolean;
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
  pictures: Picture[];
  mode: Mode;
  running: boolean;
  minimized: boolean;
  /** null while we are still looking */
  agentFound: boolean | null;
  sessionId: string | null;
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
  pictures: [],
  mode: savedMode(),
  running: false,
  minimized: false,
  agentFound: null,
  sessionId: null,
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
  set({ messages: [...state.messages, { ...m, id }] });
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

/** Switch to another AI tool. The conversation starts fresh, since tools cannot share one. */
export function setAgent(agent: AgentId) {
  try {
    localStorage.setItem(AGENT_KEY, agent);
  } catch {
    /* ignore */
  }
  declineAllWaiting();
  set({ agent, agentFound: state.installed[agent] ?? false, messages: [], pictures: state.pictures.filter((p) => !p.sent), sessionId: null });
}
export function setModel(agent: AgentId, model: string) {
  try {
    localStorage.setItem(`duet:model:${agent}`, model);
  } catch {
    /* ignore */
  }
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

export function newConversation() {
  declineAllWaiting();
  set({ messages: [], pictures: state.pictures.filter((p) => !p.sent), sessionId: null });
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
