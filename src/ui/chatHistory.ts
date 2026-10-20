import type { Msg } from "../ai/chat";
import { isOutside } from "../ai/who";

/**
 * The chat is the history. What was said, every change, and every version sit on one line, in the
 * order they happened. An AI's changes fold under what it said. Changes made on the canvas, by the
 * designer or by an AI from its own window, sit between the messages, at the time they were made.
 */

/** A moment of the history, as the chat needs it. */
export interface Moment {
  label: string;
  actor: "you" | "ai";
  by?: string;
  time: number;
  version?: string;
  step?: string;
}

/** One change on the line. `at` is its place in the history, or -1 when that is gone. */
export interface Change {
  key: string;
  text: string;
  at: number;
  /** The history step's own name, which stays the same when the project is opened again. */
  step?: string;
  /** The chat's own line about it, when there is one. */
  msg?: Msg;
}

export type Item =
  | { kind: "msg"; key: string; msg: Msg; time: number }
  | { kind: "changes"; key: string; actor: "you" | "ai"; by?: string; changes: Change[]; time: number }
  | { kind: "version"; key: string; name: string; at: number; time: number };

const isChange = (m: Msg) => m.role === "note" && !m.proposal && !m.approval && (m.step !== undefined || m.undoStep !== undefined);

/** Everything the chat shows, in order. `main` is the project's main chat; a task shows only what was said in it. */
export function chatHistory(messages: Msg[], timeline: Moment[], main: boolean): Item[] {
  const where = new Map<string, number>();
  timeline.forEach((e, i) => e.step && where.set(e.step, i));
  // a change whose step was thrown away, by going back and changing something else, points nowhere
  const at = (m: Msg) => (m.step ? (where.get(m.step) ?? -1) : m.undoStep !== undefined && m.undoStep < timeline.length ? m.undoStep : -1);

  const said: Item[] = [];
  const saidAbout = new Map<number, number>();
  for (const m of messages) {
    if (m.role === "working") continue;
    if (!isChange(m)) {
      said.push({ kind: "msg", key: `m${m.id}`, msg: m, time: m.time ?? 0 });
      continue;
    }
    const i = at(m);
    if (i >= 0) saidAbout.set(i, m.time ?? 0);
    const by = i >= 0 ? timeline[i].by : undefined;
    const actor = i >= 0 ? timeline[i].actor : "ai";
    const change: Change = { key: `m${m.id}`, text: m.text, at: i, step: m.step ?? (i >= 0 ? timeline[i].step : undefined), msg: m };
    const last = said[said.length - 1];
    // a change that points nowhere stays with the ones it was made beside
    if (last?.kind === "changes" && (i < 0 || (last.by === by && last.actor === actor))) last.changes.push(change);
    else said.push({ kind: "changes", key: `g${m.id}`, actor, by, changes: [change], time: m.time ?? 0 });
  }

  const between: Item[] = [];
  timeline.forEach((e, i) => {
    if (e.version) between.push({ kind: "version", key: `v${i}`, name: e.version, at: i, time: Math.max(e.time, saidAbout.get(i) ?? 0) + 0.5 });
  });
  if (main) {
    let run: Extract<Item, { kind: "changes" }> | null = null;
    let lastAt = -2;
    for (let i = 1; i < timeline.length; i++) {
      const e = timeline[i];
      // the chat already says what its own AI did; only the canvas and outside windows are added
      if (saidAbout.has(i) || !(e.actor === "you" || isOutside(e.by))) continue;
      const change: Change = { key: `s${i}`, text: e.label, at: i, step: e.step };
      if (run && lastAt === i - 1 && run.actor === e.actor && run.by === e.by) run.changes.push(change);
      else {
        run = { kind: "changes", key: `r${i}`, actor: e.actor, by: e.by, changes: [change], time: e.time };
        between.push(run);
      }
      lastAt = i;
    }
  }
  between.sort((a, b) => a.time - b.time);

  const out: Item[] = [];
  let j = 0;
  for (const item of said) {
    while (j < between.length && between[j].time <= item.time) out.push(between[j++]);
    out.push(item);
  }
  while (j < between.length) out.push(between[j++]);
  return out;
}

export interface Found {
  /** Where to go: the message, change or version. */
  key: string;
  /** The folded group it sits in, which must open first. */
  group?: string;
  kind: "said" | "change" | "version" | "name";
  text: string;
}

const snippet = (text: string, from: number, q: number) => {
  // a short line shows whole; a long one around what was found
  if (text.length <= 80) return text.replace(/\s+/g, " ").trim();
  const start = Math.max(0, from - 24);
  const end = Math.min(text.length, from + q + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
};

/** Search what was said, the changes, the versions and the AIs' names. Newest first. */
export function findInHistory(items: Item[], query: string, nameOf: (by: string | undefined) => string, limit = 12): Found[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const found: Found[] = [];
  const names = new Set<string>();
  for (const item of [...items].reverse()) {
    if (item.kind === "msg") {
      const m = item.msg;
      const name = m.role === "duet" ? nameOf(m.by) : "";
      if (name && !names.has(name) && name.toLowerCase().includes(q)) names.add(name);
      const hit = m.text.toLowerCase().indexOf(q);
      if (hit >= 0) found.push({ key: item.key, kind: "said", text: snippet(m.text, hit, q.length) });
    } else if (item.kind === "changes") {
      for (const c of [...item.changes].reverse()) {
        const hit = c.text.toLowerCase().indexOf(q);
        if (hit >= 0) found.push({ key: c.key, group: item.key, kind: "change", text: snippet(c.text, hit, q.length) });
      }
    } else if (item.name.toLowerCase().includes(q)) found.push({ key: item.key, kind: "version", text: item.name });
  }
  // a name found goes to the first thing that AI said
  const byName: Found[] = [];
  for (const name of names) {
    const first = items.find((i) => i.kind === "msg" && i.msg.role === "duet" && nameOf(i.msg.by) === name);
    if (first) byName.push({ key: first.key, kind: "name", text: name });
  }
  return [...byName, ...found].slice(0, limit);
}
