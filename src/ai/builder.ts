import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { inTestDesign, leaveTestDesign, startTestDesign } from "../project/project";
import type { ToolDef, ToolResult } from "./tools";

/**
 * Tools for the people and AIs who build Duet, not for designers. They let an AI check the interface
 * itself: start a clean test design, read what the panels show, press things, and read errors.
 * Only the build Duet is developed with loads this file (see `mcp.ts`). A downloaded app never has them.
 * They press the interface like a hand would, so the permission levels in `tools.ts` do not apply here.
 */

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const held = { type: "array", items: str, description: "Keys held down: any of alt, shift, cmd, ctrl." };
const which = {
  n: { ...num, description: "The number of a line from the last dev_read_interface." },
  name: { ...str, description: "What the thing is called: its label, its hint, or the words on it. Not needed with n." },
  nth: { ...num, description: "When several things share the name: which one, counting from 1." },
};

export const GUIDE = `Builder tools check Duet's own interface. They exist only in the build Duet is developed with.

How to check a change:
1. dev_test_design puts the open project away and starts a clean design with no file. Nothing in it is ever saved. Pass sample true for a frame that holds a shape and a group, with a plain shape beside it.
2. Change the design with the ordinary tools (create_element, set_props and so on) if the check needs more on the canvas.
3. dev_read_interface says what the panels show, as numbered lines of words. Pass filter to see only lines with a word in them.
4. dev_press presses something by its name or by its line number. dev_type writes in a box. dev_key presses a key.
5. Read the interface again to see what changed. Line numbers are only good until the next read.
6. dev_errors lists what went wrong since the last look.
7. After Duet's code changes, dev_reload loads the interface again. The test design is lost, so start a new one.
8. dev_leave_test_design throws the test design away and brings the project back. Always finish with it.

A line reads: number, kind, "name", then its marks. The marks are the style names on it (sel is selected, on is switched on, folded is folded shut), its value if it is a box, and off if it cannot be pressed. Lines pushed in are inside the line above.
What these tools cannot do: draw on the canvas by dragging, drag a layer, or answer a window from the system such as Save.`;

export const BUILDER_TOOLS: ToolDef[] = [
  { name: "dev_guide", description: "Builder tool. How to check Duet's interface with the dev_ tools. Read it once.", inputSchema: { type: "object", properties: {} } },
  {
    name: "dev_test_design",
    description: "Builder tool. Put the open project away and start a clean test design that is never saved. Call it before any check, so a real project is never touched.",
    inputSchema: { type: "object", properties: { sample: { ...bool, description: "True to start with a frame that holds a shape and a group, and a plain shape beside it." } } },
  },
  { name: "dev_leave_test_design", description: "Builder tool. Throw the test design away and bring back the project that was open before it.", inputSchema: { type: "object", properties: {} } },
  {
    name: "dev_read_interface",
    description: "Builder tool. What the interface shows right now, as numbered lines of words: buttons, boxes, rows and text, with their marks.",
    inputSchema: { type: "object", properties: { filter: { ...str, description: "Only lines with these words in them." }, max: { ...num, description: "The most lines to give back. 200 if left out." } } },
  },
  {
    name: "dev_press",
    description: "Builder tool. Press something in the interface, by line number or by name.",
    inputSchema: { type: "object", properties: { ...which, keys: held, double: { ...bool, description: "True for a double click." }, right: { ...bool, description: "True for a right click." } } },
  },
  {
    name: "dev_type",
    description: "Builder tool. Write in a box, replacing what is in it.",
    inputSchema: { type: "object", properties: { ...which, text: str, enter: { ...bool, description: "True to press Enter after." } }, required: ["text"] },
  },
  {
    name: "dev_key",
    description: "Builder tool. Press a key, such as f, Escape, Delete or ArrowLeft, as if the canvas had the attention.",
    inputSchema: { type: "object", properties: { key: str, keys: held }, required: ["key"] },
  },
  { name: "dev_reload", description: "Builder tool. Load the interface again, so a change to Duet's code is surely the one running. A test design does not survive it: the project that was open comes back.", inputSchema: { type: "object", properties: {} } },
  {
    name: "dev_errors",
    description: "Builder tool. Errors and warnings Duet has shown since the last look.",
    inputSchema: { type: "object", properties: { keep: { ...bool, description: "True to leave them in the list." } } },
  },
];

export const isBuilderTool = (name: string) => BUILDER_TOOLS.some((t) => t.name === name);

// ---- errors ----

const errors: string[] = [];
let watching = false;

function note(kind: string, parts: unknown[]) {
  const text = parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  errors.push(`${kind}: ${text.slice(0, 600)}`);
  if (errors.length > 50) errors.shift();
}

/** Start keeping what goes wrong. Called once when the tools are switched on. */
export function watchErrors() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("error", (e) => note("error", [e.error ?? e.message]));
  window.addEventListener("unhandledrejection", (e) => note("error", [e.reason]));
  for (const kind of ["error", "warn"] as const) {
    const was = console[kind].bind(console);
    console[kind] = (...parts: unknown[]) => {
      note(kind === "warn" ? "warning" : "error", parts);
      was(...parts);
    };
  }
}

// ---- reading the interface ----

export interface Line {
  kind: string;
  name: string;
  marks: string[];
  depth: number;
}

/** One line the way an AI reads it. */
export function lineText(n: number, l: Line): string {
  return `${"  ".repeat(l.depth)}${n} ${l.kind} "${l.name}"${l.marks.length ? ` [${l.marks.join(", ")}]` : ""}`;
}

/**
 * Which line a name means. An exact name wins over one that only holds the words.
 * Returns the place in the list, or a message that says why none was picked.
 */
export function pick(lines: Pick<Line, "kind" | "name">[], name: string, nth?: number): number | string {
  const want = name.trim().toLowerCase();
  if (!want) return "Say which thing: give n or name.";
  const pressable = lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind !== "text");
  const exact = pressable.filter((x) => x.l.name.toLowerCase() === want);
  const found = exact.length ? exact : pressable.filter((x) => x.l.name.toLowerCase().includes(want));
  if (!found.length) return `Nothing on the screen is called "${name}". Read the interface again.`;
  if (nth !== undefined) return found[nth - 1]?.i ?? `There are only ${found.length} things called "${name}".`;
  if (found.length > 1) return `${found.length} things are called "${name}": lines ${found.map((x) => x.i + 1).join(", ")}. Give n, or nth.`;
  return found[0].i;
}

const PRESSABLE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [draggable="true"], [title], [contenteditable="true"]';
const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "CANVAS", "NOSCRIPT", "OPTION"]);

let lastRead: { line: Line; el: HTMLElement }[] = [];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Something made to be pressed that says so only by its pointer, such as a tab or an idea in the chat. */
function pointsAt(el: HTMLElement): boolean {
  if (getComputedStyle(el).cursor !== "pointer") return false;
  // the pointer is handed down to everything inside, so only the outermost one counts
  return !el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer";
}

const isBox = (el: HTMLElement) => el.matches("input, textarea, select");

/** The words beside a box that say what it is for. */
function labelOf(el: HTMLElement): string {
  const label = el.closest("label") ?? el.previousElementSibling;
  return label && label !== el ? squash(label.textContent ?? "") : "";
}

function nameOf(el: HTMLElement): string {
  const box = el as HTMLInputElement;
  const words = squash(el.textContent ?? "");
  // a holder with a hint, such as the top of the chat, is named by the hint, not by everything inside it
  const holder = !!el.title && el.children.length > 0 && !el.matches("button, a[href]") && !el.draggable;
  const own = el.getAttribute("aria-label") || (isBox(el) ? box.placeholder || box.title || labelOf(el) || box.name : holder ? el.title : words || el.title) || "";
  return squash(own).slice(0, 80);
}

function kindOf(el: HTMLElement): string {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el.matches("button")) return "button";
  if (el.matches("a[href]")) return "link";
  if (el.matches("select")) return "choice";
  if (el.matches("input, textarea, [contenteditable='true']")) return "box";
  if (el.draggable) return "row";
  return "thing";
}

function marksOf(el: HTMLElement): string[] {
  const marks = [...el.classList];
  const box = el as HTMLInputElement;
  if (el.matches("input[type='checkbox'], input[type='radio']")) marks.push(box.checked ? "ticked" : "not ticked");
  else if (el.matches("input, textarea, select")) marks.push(`value ${JSON.stringify(box.value)}`);
  if (el.title && squash(el.title).slice(0, 80) !== nameOf(el)) marks.push(`hint ${JSON.stringify(squash(el.title).slice(0, 80))}`);
  if (box.disabled) marks.push("off");
  return marks;
}

function shown(el: HTMLElement): boolean {
  if (!el.getClientRects().length) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function walk(el: HTMLElement, depth: number, covered: boolean, out: { line: Line; el: HTMLElement }[]) {
  if (SKIP.has(el.tagName.toUpperCase()) || !shown(el)) return;
  let inside = depth;
  let under = covered;
  // a holder is named by its hint, so the words inside it are still listed
  const holder = el.matches(PRESSABLE) && !!el.title && nameOf(el) === squash(el.title).slice(0, 80) && el.children.length > 0;
  if (el.matches(PRESSABLE) || (!covered && pointsAt(el))) {
    out.push({ line: { kind: kindOf(el), name: nameOf(el), marks: marksOf(el), depth }, el });
    inside = depth + 1;
    under = !holder; // its words are its name, so they are not listed again
  } else if (!covered) {
    const words = squash([...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent ?? "").join(" "));
    if (words) out.push({ line: { kind: "text", name: words.slice(0, 160), marks: [], depth }, el });
  }
  for (const child of el.children) if (child instanceof HTMLElement) walk(child, inside, under, out);
}

function readInterface(filter: unknown, max: unknown): string {
  lastRead = [];
  walk(document.body, 0, false, lastRead);
  const want = typeof filter === "string" ? filter.trim().toLowerCase() : "";
  const all = lastRead.map((r, i) => lineText(i + 1, r.line));
  const lines = want ? all.filter((t) => t.toLowerCase().includes(want)) : all;
  const most = typeof max === "number" && max > 0 ? Math.floor(max) : 200;
  const more = lines.length > most ? `\n${lines.length - most} more lines. Use filter to see less at once.` : "";
  return lines.length ? lines.slice(0, most).join("\n") + more : want ? `No line has "${filter}" in it.` : "The interface is empty.";
}

// ---- pressing ----

type Args = Record<string, unknown>;

const fail = (text: string): ToolResult => ({ text, isError: true });
/** Long enough for the interface to draw what the press changed. */
const settle = () => new Promise<void>((r) => setTimeout(r, 80));

function find(a: Args): HTMLElement | string {
  if (typeof a.n === "number") {
    const hit = lastRead[a.n - 1]?.el;
    if (!hit) return `There is no line ${a.n}. Read the interface again.`;
    if (!hit.isConnected) return `Line ${a.n} is no longer on the screen. Read the interface again.`;
    return hit;
  }
  // a name is looked up on the screen as it is now, not as it was at the last read
  const now: { line: Line; el: HTMLElement }[] = [];
  walk(document.body, 0, false, now);
  const at = pick(now.map((r) => r.line), String(a.name ?? ""), typeof a.nth === "number" ? a.nth : undefined);
  return typeof at === "string" ? at : now[at].el;
}

function heldKeys(list: unknown) {
  const keys = Array.isArray(list) ? list.map((k) => String(k).toLowerCase()) : [];
  return { altKey: keys.includes("alt"), shiftKey: keys.includes("shift"), metaKey: keys.includes("cmd"), ctrlKey: keys.includes("ctrl") };
}

async function press(a: Args): Promise<ToolResult> {
  const el = find(a);
  if (typeof el === "string") return fail(el);
  if ((el as HTMLButtonElement).disabled) return fail(`"${nameOf(el)}" is switched off and cannot be pressed.`);
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: a.right ? 2 : 0, ...heldKeys(a.keys) };
  el.dispatchEvent(new PointerEvent("pointerdown", at));
  el.dispatchEvent(new MouseEvent("mousedown", at));
  if (el.matches("input, textarea, select, [contenteditable='true']")) el.focus();
  el.dispatchEvent(new PointerEvent("pointerup", at));
  el.dispatchEvent(new MouseEvent("mouseup", at));
  if (a.right) el.dispatchEvent(new MouseEvent("contextmenu", at));
  else {
    el.dispatchEvent(new MouseEvent("click", at));
    if (a.double) {
      el.dispatchEvent(new MouseEvent("click", { ...at, detail: 2 }));
      el.dispatchEvent(new MouseEvent("dblclick", { ...at, detail: 2 }));
    }
  }
  await settle();
  return { text: `Pressed "${nameOf(el)}".${errors.length ? ` ${errors.length} errors or warnings are waiting in dev_errors.` : ""}` };
}

async function type(a: Args): Promise<ToolResult> {
  const el = find(a);
  if (typeof el === "string") return fail(el);
  if (!el.matches("input, textarea")) return fail(`"${nameOf(el)}" is not a box you can write in.`);
  const box = el as HTMLInputElement | HTMLTextAreaElement;
  box.focus();
  // the interface only hears a change that goes through the box's own setter
  const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(box, String(a.text ?? ""));
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
  if (a.enter) {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }
  await settle();
  return { text: `Wrote in "${nameOf(el)}".` };
}

async function key(a: Args): Promise<ToolResult> {
  const name = String(a.key ?? "");
  if (!name) return fail("Say which key.");
  // a box that still has the attention would swallow the key
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
  const code = name.length === 1 ? (/[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : /\d/.test(name) ? `Digit${name}` : name) : name;
  const init = { key: name, code, bubbles: true, cancelable: true, ...heldKeys(a.keys) };
  document.body.dispatchEvent(new KeyboardEvent("keydown", init));
  document.body.dispatchEvent(new KeyboardEvent("keyup", init));
  await settle();
  return { text: `Pressed the ${name} key.` };
}

/** A frame that holds a shape and a group, and a plain shape beside it. Enough to check most panels. */
export function sampleDoc() {
  let doc = emptyDoc();
  doc = runCommand(doc, "create_element", { id: "test-frame", type: "frame", x: 0, y: 0, width: 400, height: 300 });
  doc = runCommand(doc, "create_element", { id: "test-inner", type: "rect", parentId: "test-frame", x: 20, y: 20, width: 80, height: 60 });
  doc = runCommand(doc, "create_element", { id: "test-grouped", type: "ellipse", parentId: "test-frame", x: 140, y: 20, width: 60, height: 60 });
  doc = runCommand(doc, "group_elements", { ids: ["test-grouped"], groupId: "test-group" });
  doc = runCommand(doc, "create_element", { id: "test-plain", type: "rect", x: 480, y: 0, width: 120, height: 120 });
  return doc;
}

/** Run one builder tool. */
export async function callBuilderTool(name: string, raw: unknown): Promise<ToolResult> {
  const a = (raw && typeof raw === "object" ? raw : {}) as Args;
  if (name === "dev_guide") return { text: GUIDE };
  if (name === "dev_test_design") {
    const why = await startTestDesign(a.sample ? sampleDoc() : emptyDoc());
    if (why) return fail(why);
    await settle();
    return { text: `A clean test design is open. Nothing in it is saved.${a.sample ? " It holds a frame (test-frame) with a shape (test-inner) and a group (test-group, holding test-grouped), and a plain shape (test-plain)." : ""} Finish with dev_leave_test_design.` };
  }
  if (name === "dev_leave_test_design") {
    const why = await leaveTestDesign();
    return why ? fail(why) : { text: "The test design is gone and the project is back." };
  }
  if (name === "dev_read_interface") return { text: `${inTestDesign() ? "" : "This is a real project, not a test design.\n"}${readInterface(a.filter, a.max)}` };
  if (name === "dev_press") return press(a);
  if (name === "dev_type") return type(a);
  if (name === "dev_key") return key(a);
  if (name === "dev_reload") {
    // answer first: the answer cannot be sent from an interface that is already gone
    setTimeout(() => window.location.reload(), 150);
    return { text: "Loading the interface again. Wait two seconds before the next call." };
  }
  if (name === "dev_errors") {
    const text = errors.length ? errors.join("\n") : "Nothing has gone wrong.";
    if (!a.keep) errors.length = 0;
    return { text };
  }
  return fail(`Unknown tool ${name}.`);
}
