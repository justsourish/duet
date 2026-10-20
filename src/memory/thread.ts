import { readGiven } from "../ai/names";

/**
 * The thread: what was said and done in a project's conversation, as Duet keeps it.
 *
 * Duet holds this itself, inside the project. The AI tool does not have to remember anything:
 * it starts fresh and is handed a note made from the thread. Everything here is plain data
 * in and plain data out, so any part of Duet can use it.
 */

/** One thing said or done, as it is kept. */
export interface Said {
  role: "you" | "duet" | "note" | "error" | "break";
  text: string;
  /** Milliseconds since 1970. */
  time: number;
  proposal?: { tool: string; args: unknown; summary: string; status: "open" | "applied" | "dismissed" };
  approval?: { summary: string; status: "allowed" | "declined" };
  /** The numbers of the pictures that went with this message. The pictures themselves are not kept. */
  pictures?: number[];
  /** The designer took this change back. */
  undone?: boolean;
  /** The name of the history step this change led to. */
  step?: string;
  /** On the last thing an AI said in a turn: which tool and model, how long, how many changes. */
  took?: { tool: string; model?: string; ms: number; changes: number };
  /** For what an AI said: the tool that said it. */
  by?: string;
}

export interface Thread {
  /** The conversation on show. */
  now: Said[];
  /** Conversations the designer closed with "Start a fresh conversation", oldest first. */
  earlier: Said[];
  /** Side conversations, each with one AI. Left out when there are none. */
  tasks?: KeptTask[];
  /** The names the AIs go by in this project, by tool. Left out when there are none. */
  names?: Record<string, string>;
}

/** A task as it is kept: which AI does it, its name, and what was said in it. */
export interface KeptTask {
  agent: string;
  title: string;
  said: Said[];
}

/** How many things one task remembers. */
const TASK_LIMIT = 200;
/** How many tasks a project remembers, the latest ones. */
const TASKS_KEPT = 30;

/** Anything the chat shows. Looser than Said, because the chat also holds passing things. */
export interface Speaking {
  role: string;
  text: string;
  time?: number;
  proposal?: { tool: string; args: unknown; summary: string; status: string };
  approval?: { summary: string; status: string };
  pictures?: number[];
  undone?: boolean;
  step?: string;
  took?: { tool: string; model?: string; ms: number; changes: number };
  by?: string;
}

/** How many things a project remembers. Older ones are let go, earlier conversations first. */
export const THREAD_LIMIT = 400;
/** One message is cut off after this many letters when it is kept. */
const TEXT_LIMIT = 4000;

const ROLES = ["you", "duet", "note", "error", "break"];
const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text);

/** Turn what the chat shows into what is worth keeping. Passing things, like "Thinking...", are left out. */
export function keepable(messages: Speaking[], now = Date.now()): Said[] {
  const out: Said[] = [];
  for (const m of messages) {
    if (!ROLES.includes(m.role)) continue;
    const said: Said = { role: m.role as Said["role"], text: cut(m.text ?? "", TEXT_LIMIT), time: m.time ?? now };
    if (m.proposal) {
      const status = m.proposal.status === "applied" || m.proposal.status === "dismissed" ? m.proposal.status : "open";
      said.proposal = { tool: m.proposal.tool, args: m.proposal.args, summary: m.proposal.summary, status };
    }
    // a question still waiting when it was put away was never answered
    if (m.approval) said.approval = { summary: m.approval.summary, status: m.approval.status === "allowed" ? "allowed" : "declined" };
    if (m.pictures?.length) said.pictures = m.pictures;
    if (m.undone) said.undone = true;
    if (typeof m.step === "string" && m.step) said.step = m.step;
    if (typeof m.by === "string" && m.by) said.by = m.by.slice(0, 60);
    const t = m.took;
    if (t && typeof t.tool === "string" && Number.isFinite(t.ms) && Number.isFinite(t.changes)) {
      said.took = { tool: t.tool, ms: t.ms, changes: t.changes, ...(typeof t.model === "string" && t.model ? { model: t.model } : {}) };
    }
    out.push(said);
  }
  return out;
}

/** The thread as the text of its file. */
export function packThread(thread: Thread): string {
  const now = thread.now.slice(-THREAD_LIMIT);
  const room = THREAD_LIMIT - now.length;
  const earlier = room > 0 ? thread.earlier.slice(-room) : [];
  const tasks = (thread.tasks ?? []).slice(-TASKS_KEPT).map((t) => ({ agent: t.agent, title: t.title, said: t.said.slice(-TASK_LIMIT) }));
  const names = thread.names && Object.keys(thread.names).length ? { names: thread.names } : {};
  return JSON.stringify(tasks.length ? { version: 1, now, earlier, tasks, ...names } : { version: 1, now, earlier, ...names });
}

function taskList(value: unknown): KeptTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is { agent: string; title?: unknown; said?: unknown } => !!t && typeof t === "object" && typeof (t as { agent?: unknown }).agent === "string")
    .map((t) => ({ agent: t.agent, title: typeof t.title === "string" ? t.title : "", said: list(t.said) }));
}

function list(value: unknown): Said[] {
  if (!Array.isArray(value)) return [];
  return keepable(
    value.filter((m): m is Speaking => !!m && typeof m === "object" && typeof (m as Speaking).role === "string" && typeof (m as Speaking).text === "string"),
    0,
  );
}

/** Read a thread file. A missing or damaged file is an empty thread, never an error: the design matters more. */
export function readThread(text: string | null | undefined): Thread {
  if (!text) return { now: [], earlier: [] };
  try {
    const raw = JSON.parse(text) as { now?: unknown; earlier?: unknown; tasks?: unknown; names?: unknown };
    const tasks = taskList(raw.tasks);
    const given = readGiven(raw.names);
    const names = Object.keys(given).length ? { names: given } : {};
    return tasks.length ? { now: list(raw.now), earlier: list(raw.earlier), tasks, ...names } : { now: list(raw.now), earlier: list(raw.earlier), ...names };
  } catch {
    return { now: [], earlier: [] };
  }
}

/** The note holds this many of the latest things said. */
const BRIEF_ENTRIES = 12;
/** Each is cut to this many letters, so the note stays a small size however long the project runs. */
const BRIEF_TEXT = 320;
/**
 * What the designer said is kept whole and never let go, because that is where they teach the AI their
 * rules. Only past this many letters, the oldest of it goes, so a very long project still has a ceiling.
 */
const BRIEF_DESIGNER = 40000;

/**
 * The note handed to an AI that starts fresh: everything the designer said, word for word, and the
 * last few things the AI said and did. Duet writes it itself, so it costs nothing to make. Empty when
 * there is nothing to tell.
 */
export function brief(now: Said[]): string {
  const lines: { text: string; designer: boolean }[] = [];
  let changes: string[] = [];
  const flush = () => {
    if (changes.length) lines.push({ text: `- You changed: ${changes.join("; ")}`, designer: false });
    changes = [];
  };
  for (const m of now) {
    if (m.role === "note" && !m.approval && !m.proposal) {
      if (m.text.trim()) changes.push(`${cut(m.text.trim(), 120)}${m.undone ? " (the designer took this back)" : ""}`);
      continue;
    }
    flush();
    if (m.role === "you") {
      const pictures = m.pictures?.length ? ` (with picture ${m.pictures.map((n) => `number ${n}`).join(", ")}, which may no longer be kept)` : "";
      lines.push({ text: `- The designer said: ${m.text.trim() || "(only pictures)"}${pictures}`, designer: true });
    } else if (m.proposal) {
      const what = m.proposal.status === "applied" ? "the designer applied it" : m.proposal.status === "dismissed" ? "the designer dismissed it" : "not applied yet";
      lines.push({ text: `- You suggested: ${cut(m.proposal.summary, BRIEF_TEXT)} (${what})`, designer: false });
    } else if (m.approval) {
      lines.push({ text: `- You asked to: ${cut(m.approval.summary, BRIEF_TEXT)} (the designer ${m.approval.status === "allowed" ? "allowed it" : "said no"})`, designer: false });
    } else if (m.role === "duet" && m.text.trim()) {
      lines.push({ text: `- You said: ${cut(m.text.trim(), BRIEF_TEXT)}`, designer: false });
    }
  }
  flush();
  if (!lines.length) return "";
  // the latest few stay whatever they are; before them, only what the designer said, newest first, up to the ceiling
  const latest = lines.length - BRIEF_ENTRIES;
  const keep = new Set<number>();
  let room = BRIEF_DESIGNER;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { text, designer } = lines[i];
    if (designer) {
      if (text.length > room && i < latest) continue;
      room -= text.length;
      keep.add(i);
    } else if (i >= latest) keep.add(i);
  }
  const kept = lines.filter((_, i) => keep.has(i)).map((l) => l.text);
  const more = kept.length < lines.length ? "What the designer said, and the latest part of the rest:" : "All of it:";
  return [
    "Duet's note on this conversation so far. You are starting fresh and do not remember it yourself.",
    "What the designer said is word for word. Rules they gave earlier still hold unless they changed them.",
    more,
    ...kept,
    "The design may have changed since. Read it again before you act.",
  ].join("\n");
}

/** A session with the AI tool is carried on only this soon after it was last used. */
export const RESUME_WITHIN = 5 * 60 * 1000;
/** And only for this many messages. After that the AI starts fresh with Duet's note, so cost does not keep growing. */
export const RESUME_MESSAGES = 8;

export interface SessionUse {
  sessionId: string | null;
  /** When the session was last used. */
  used: number;
  /** How many messages it has taken. */
  messages: number;
}

/**
 * Carry on the AI tool's own session, or start fresh with Duet's note? A quick back and forth is
 * cheap to carry on. Anything long or old is cheaper and just as good started fresh.
 */
export function carryOn(use: SessionUse, now = Date.now()): boolean {
  return !!use.sessionId && use.messages < RESUME_MESSAGES && now - use.used < RESUME_WITHIN;
}
