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
  /** History step this change created, so Undo can take it back. */
  undoStep?: number;
  undone?: boolean;
}

export interface ChatState {
  messages: Msg[];
  mode: Mode;
  running: boolean;
  minimized: boolean;
  /** null while we are still looking */
  agentFound: boolean | null;
  sessionId: string | null;
}

const MODE_KEY = "duet:ai-mode";

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
  messages: [],
  mode: savedMode(),
  running: false,
  minimized: false,
  agentFound: null,
  sessionId: null,
};
let nextId = 1;
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
export const setSessionId = (sessionId: string | null) => set({ sessionId });

export function newConversation() {
  set({ messages: [], sessionId: null });
}

/** Ask the designer a yes or no question and wait for the answer. */
export function askDesigner(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = addMsg({ role: "note", text: "", approval: { summary, status: "waiting" } });
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
