import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import contrast from "./skills/contrast.md?raw";
import mobile from "./skills/mobile-screens.md?raw";
import spacing from "./skills/spacing.md?raw";
import typeScale from "./skills/type-scale.md?raw";

export interface Skill {
  id: string;
  name: string;
  summary: string;
  body: string;
  source: "shipped" | "mine";
  enabled: boolean;
}

const SHIPPED: Record<string, string> = {
  "mobile-screens": mobile,
  spacing,
  "type-scale": typeScale,
  contrast,
};

const KEY = "duet:skills-off";

/** First heading is the name, the first line after it is the summary. */
export function describeSkill(body: string, fallback: string): { name: string; summary: string } {
  const lines = body.split("\n").map((l) => l.trim());
  const h = lines.findIndex((l) => l.startsWith("# "));
  const name = h >= 0 ? lines[h].slice(2).trim() : fallback;
  const summary = lines.slice(h + 1).find((l) => l && !l.startsWith("#") && !l.startsWith("-")) ?? "";
  return { name: name || fallback, summary };
}

function offSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveOff(set: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

let skills: Skill[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function build(mine: { id: string; body: string }[]): Skill[] {
  const off = offSet();
  const shipped = Object.entries(SHIPPED).map(([id, body]) => ({
    id,
    body,
    ...describeSkill(body, id),
    source: "shipped" as const,
    enabled: !off.has(id),
  }));
  const own = mine.map(({ id, body }) => ({
    id: `mine-${id}`,
    body,
    ...describeSkill(body, id),
    source: "mine" as const,
    enabled: !off.has(`mine-${id}`),
  }));
  return [...shipped, ...own];
}

skills = build([]);

export async function loadSkills() {
  let mine: { id: string; body: string }[] = [];
  try {
    mine = await invoke<{ id: string; body: string }[]>("list_user_skills");
  } catch {
    /* outside the desktop app there are no saved skills */
  }
  skills = build(mine);
  emit();
}

export const getSkills = () => skills;
export function useSkills(): Skill[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => skills,
  );
}

export function toggleSkill(id: string) {
  const off = offSet();
  if (off.has(id)) off.delete(id);
  else off.add(id);
  saveOff(off);
  skills = skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
  emit();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

/** Save a skill of your own. Returns a message if it could not be saved. */
export async function createSkill(name: string, rules: string): Promise<string | null> {
  const id = slug(name);
  if (!id) return "Give the skill a name.";
  if (!rules.trim()) return "Write at least one rule.";
  if (skills.some((s) => s.id === `mine-${id}`)) return "You already have a skill with that name.";
  const body = `# ${name.trim()}\n${rules.trim()}\n`;
  try {
    await invoke("write_user_skill", { id, body });
  } catch (e) {
    return String(e);
  }
  await loadSkills();
  return null;
}

export async function deleteSkill(skillId: string) {
  if (!skillId.startsWith("mine-")) return;
  try {
    await invoke("delete_user_skill", { id: skillId.slice(5) });
  } catch {
    /* ignore */
  }
  await loadSkills();
}
