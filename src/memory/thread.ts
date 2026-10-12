/**
 * The thread: what was said and done in a project's conversation, as Duet keeps it.
 *
 * Duet holds this itself, inside the project. The AI tool does not have to remember anything:
 * it starts fresh and is handed a short note made from the thread. Everything here is plain data
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
}

export interface Thread {
  /** The conversation on show. */
  now: Said[];
  /** Conversations the designer closed with "Start a fresh conversation", oldest first. */
  earlier: Said[];
}

/** Anything the chat shows. Looser than Said, because the chat also holds passing things. */
export interface Speaking {
  role: string;
  text: string;
  time?: number;
  proposal?: { tool: string; args: unknown; summary: string; status: string };
  approval?: { summary: string; status: string };
  pictures?: number[];
  undone?: boolean;
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
    out.push(said);
  }
  return out;
}

/** The thread as the text of its file. */
export function packThread(thread: Thread): string {
  const now = thread.now.slice(-THREAD_LIMIT);
  const room = THREAD_LIMIT - now.length;
  const earlier = room > 0 ? thread.earlier.slice(-room) : [];
  return JSON.stringify({ version: 1, now, earlier });
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
    const raw = JSON.parse(text) as { now?: unknown; earlier?: unknown };
    return { now: list(raw.now), earlier: list(raw.earlier) };
  } catch {
    return { now: [], earlier: [] };
  }
}

/** The note holds this many of the latest things said. */
const BRIEF_ENTRIES = 12;
/** Each is cut to this many letters, so the note stays the same small size however long the project runs. */
const BRIEF_TEXT = 320;

/**
 * The short note handed to an AI that starts fresh: the last few things said and done in this
 * conversation. Duet writes it itself, so it costs nothing to make. Empty when there is nothing to tell.
 */
export function brief(now: Said[]): string {
  const lines: string[] = [];
  let changes: string[] = [];
  const flush = () => {
    if (changes.length) lines.push(`- You changed: ${changes.join("; ")}`);
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
      lines.push(`- The designer said: ${cut(m.text.trim() || "(only pictures)", BRIEF_TEXT)}${pictures}`);
    } else if (m.proposal) {
      const what = m.proposal.status === "applied" ? "the designer applied it" : m.proposal.status === "dismissed" ? "the designer dismissed it" : "not applied yet";
      lines.push(`- You suggested: ${cut(m.proposal.summary, BRIEF_TEXT)} (${what})`);
    } else if (m.approval) {
      lines.push(`- You asked to: ${cut(m.approval.summary, BRIEF_TEXT)} (the designer ${m.approval.status === "allowed" ? "allowed it" : "said no"})`);
    } else if (m.role === "duet" && m.text.trim()) {
      lines.push(`- You said: ${cut(m.text.trim(), BRIEF_TEXT)}`);
    }
  }
  flush();
  if (!lines.length) return "";
  const kept = lines.slice(-BRIEF_ENTRIES);
  const more = lines.length > kept.length ? "The latest part of it:" : "All of it:";
  return [
    "Duet's note on this conversation so far. You are starting fresh and do not remember it yourself.",
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
