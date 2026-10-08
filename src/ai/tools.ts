import { commandLabel, newId } from "../commands";
import type { CommandName } from "../commands";
import { measureText } from "../canvas/text";
import type { El } from "../document/types";
import { saveNow } from "../project/project";
import { currentDoc, dispatch, getState, goTo, select } from "../state/store";
import { addMsg, askDesigner, getChat, updateMsg } from "./chat";
import { getSkills } from "./skills";

/**
 * What an agent can do in Duet. These are the same commands the interface uses.
 * The designer's permission level is enforced here, not left to the agent's good manners.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const str = { type: "string" };
const num = { type: "number" };
const ids = { type: "array", items: str, description: "Element ids, from get_document." };
const props = {
  type: "object",
  description:
    "Any of: name, x, y, width, height (numbers, in pixels), fill (hex colour like #1b1b1f), stroke (hex colour, or null for none), strokeWidth, radius (corner radius), opacity (0 to 1), text, fontSize, shadow ({x, y, blur, color} or null), gradient ({from, to, angle in degrees, 90 runs top to bottom} or null, replaces the fill), link (id of a frame to open when this is clicked in Present mode, or null).",
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_context",
    description:
      "Start here. Returns the project, what the designer has selected, the frames on the page, the permission level, and which skills are loaded.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_document",
    description:
      "Returns every element on the page. x and y are relative to the parent frame, or to the page for top-level things. Order in childIds and rootIds goes back to front.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "select_elements",
    description: "Select elements so the designer can see which things you are talking about. Pass an empty list to clear.",
    inputSchema: { type: "object", properties: { ids }, required: ["ids"] },
  },
  {
    name: "create_element",
    description:
      "Add a frame, rectangle, ellipse or text. x and y are relative to parentId (a frame), or to the page when parentId is left out. For text, put the words in props.text and leave width and height out so they fit the words.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["frame", "rect", "ellipse", "text"] },
        x: num,
        y: num,
        width: num,
        height: num,
        parentId: { ...str, description: "A frame to put it in. Leave out for the page." },
        props,
      },
      required: ["type", "x", "y"],
    },
  },
  {
    name: "set_props",
    description: "Change properties of one or more elements.",
    inputSchema: { type: "object", properties: { ids, props }, required: ["ids", "props"] },
  },
  {
    name: "move_elements",
    description: "Move elements by dx and dy pixels.",
    inputSchema: { type: "object", properties: { ids, dx: num, dy: num }, required: ["ids", "dx", "dy"] },
  },
  {
    name: "resize_element",
    description: "Set the position and size of one element. x and y are relative to its parent.",
    inputSchema: {
      type: "object",
      properties: { id: str, x: num, y: num, width: num, height: num },
      required: ["id", "x", "y", "width", "height"],
    },
  },
  {
    name: "reparent_elements",
    description:
      "Move elements into a frame, or out to the page. They stay where they look. index is the place in the stack, later is in front.",
    inputSchema: {
      type: "object",
      properties: { ids, parentId: { ...str, description: "Frame id, or leave out for the page." }, index: num },
      required: ["ids"],
    },
  },
  {
    name: "delete_elements",
    description: "Delete elements and everything inside them. The designer may be asked to approve this.",
    inputSchema: { type: "object", properties: { ids }, required: ["ids"] },
  },
];

const EDITS = new Set(["create_element", "set_props", "move_elements", "resize_element", "reparent_elements"]);
const RISKY = new Set(["delete_elements"]);

type Args = Record<string, unknown>;

const fail = (text: string): ToolResult => ({ text, isError: true });

function missing(list: unknown): string[] {
  const doc = currentDoc();
  return Array.isArray(list) ? list.filter((i) => typeof i !== "string" || !doc.elements[i]).map(String) : ["(not a list)"];
}

function nameOf(id: unknown): string {
  return typeof id === "string" ? (currentDoc().elements[id]?.name ?? String(id)) : String(id);
}

function namesOf(list: unknown): string {
  return Array.isArray(list) ? list.map(nameOf).join(", ") : "";
}

/** A sentence a designer would say, for approvals and suggestions. */
export function summarise(tool: string, a: Args): string {
  switch (tool) {
    case "create_element": {
      const p = (a.props ?? {}) as Partial<El>;
      return `Add a ${a.type === "rect" ? "rectangle" : String(a.type)}${p.text ? ` that says "${p.text}"` : ""}`;
    }
    case "set_props": {
      const p = (a.props ?? {}) as Record<string, unknown>;
      return `Change ${namesOf(a.ids)}: ${Object.entries(p).map(([k, v]) => `${k} ${String(v)}`).join(", ")}`;
    }
    case "move_elements":
      return `Move ${namesOf(a.ids)} by ${String(a.dx)}, ${String(a.dy)}`;
    case "resize_element":
      return `Resize ${nameOf(a.id)} to ${String(a.width)} by ${String(a.height)}`;
    case "reparent_elements":
      return `Move ${namesOf(a.ids)} ${a.parentId ? `into ${nameOf(a.parentId)}` : "out to the page"}`;
    case "delete_elements":
      return `Delete ${namesOf(a.ids)}`;
    default:
      return tool;
  }
}

/** Check the arguments and fill in anything that can be worked out. Returns an error message if it cannot be done. */
function prepare(tool: string, raw: Args): { args: Args } | { error: string } {
  const a: Args = { ...raw };
  const doc = currentDoc();
  switch (tool) {
    case "create_element": {
      if (!["frame", "rect", "ellipse", "text"].includes(String(a.type))) return { error: "type must be frame, rect, ellipse or text." };
      if (typeof a.x !== "number" || typeof a.y !== "number") return { error: "x and y must be numbers." };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      const p: Record<string, unknown> = { ...((a.props as Record<string, unknown>) ?? {}) };
      if (a.type === "text") {
        const text = typeof p.text === "string" ? p.text : "Text";
        const size = typeof p.fontSize === "number" ? p.fontSize : 16;
        const m = measureText(text, size);
        p.text = text;
        p.fontSize = size;
        a.width = typeof a.width === "number" ? a.width : m.width + 2;
        a.height = typeof a.height === "number" ? a.height : m.height;
      } else {
        const fallback = a.type === "frame" ? { w: 360, h: 640 } : { w: 120, h: 120 };
        a.width = typeof a.width === "number" ? a.width : fallback.w;
        a.height = typeof a.height === "number" ? a.height : fallback.h;
      }
      a.props = p;
      a.id = newId(String(a.type));
      return { args: a };
    }
    case "set_props": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}. Use get_document to see the ids.` };
      if (!a.props || typeof a.props !== "object") return { error: "props must be an object." };
      const p: Record<string, unknown> = { ...(a.props as Record<string, unknown>) };
      for (const forbidden of ["id", "type", "parentId", "childIds"]) delete p[forbidden];
      // text that changes size should resize to fit, unless the agent said otherwise
      const list = a.ids as string[];
      if (list.length === 1 && doc.elements[list[0]].type === "text" && ("text" in p || "fontSize" in p) && !("width" in p)) {
        const el = doc.elements[list[0]];
        const m = measureText(String(p.text ?? el.text), Number(p.fontSize ?? el.fontSize));
        p.width = m.width + 2;
        p.height = m.height;
      }
      a.props = p;
      return { args: a };
    }
    case "move_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      if (typeof a.dx !== "number" || typeof a.dy !== "number") return { error: "dx and dy must be numbers." };
      return { args: a };
    }
    case "resize_element": {
      if (missing([a.id]).length) return { error: `No element with id: ${String(a.id)}.` };
      for (const k of ["x", "y", "width", "height"]) if (typeof a[k] !== "number") return { error: `${k} must be a number.` };
      return { args: a };
    }
    case "reparent_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      a.parentId = a.parentId ?? null;
      return { args: a };
    }
    case "delete_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      return { args: a };
    }
    default:
      return { error: `Unknown tool ${tool}.` };
  }
}

/** The step before the AI acts is already saved, so any AI change can be undone and the earlier state is safe. */
async function ensureSaved() {
  const p = getState().project;
  if (p.path && p.status !== "saved") await saveNow();
}

async function apply(tool: string, args: Args): Promise<ToolResult> {
  await ensureSaved();
  const label = commandLabel(tool as CommandName, args as never);
  dispatch(tool as CommandName, args as never, "ai");
  const step = getState().cursor;
  addMsg({ role: "note", text: summarise(tool, args), undoStep: step });
  void saveNow();
  if (tool === "create_element") {
    const el = currentDoc().elements[String(args.id)];
    return { text: `Created ${String(args.id)} named "${el?.name}" (${label}).` };
  }
  return { text: `Done: ${label}.` };
}

/** Called when the designer taps Apply on a suggestion. */
export async function applyProposal(msgId: number) {
  const msg = getChat().messages.find((m) => m.id === msgId);
  if (!msg?.proposal || msg.proposal.status !== "open") return;
  const check = prepare(msg.proposal.tool, msg.proposal.args as Args);
  if ("error" in check) {
    updateMsg(msgId, { proposal: { ...msg.proposal, status: "dismissed" } });
    addMsg({ role: "error", text: `That suggestion no longer fits the design. ${check.error}` });
    return;
  }
  updateMsg(msgId, { proposal: { ...msg.proposal, status: "applied" } });
  await apply(msg.proposal.tool, check.args);
}

/** Take back an AI change, if nothing happened after it. */
export function undoAiStep(msgId: number) {
  const msg = getChat().messages.find((m) => m.id === msgId);
  if (msg?.undoStep === undefined) return;
  const s = getState();
  if (s.cursor !== msg.undoStep) return;
  goTo(msg.undoStep - 1);
  updateMsg(msgId, { undone: true });
}

function context(): string {
  const s = getState();
  const doc = currentDoc();
  const frames = doc.rootIds
    .map((id) => doc.elements[id])
    .filter((e) => e && e.type === "frame")
    .map((e) => ({ id: e.id, name: e.name, width: e.width, height: e.height }));
  return JSON.stringify(
    {
      project: s.project.name,
      saved: !!s.project.path,
      permission: getChat().mode,
      selection: s.selection.filter((i) => doc.elements[i]).map((i) => ({ id: i, name: doc.elements[i].name, type: doc.elements[i].type })),
      frames,
      elementCount: Object.keys(doc.elements).length,
      units: "pixels. x and y are relative to the parent frame, or to the page for top-level things.",
      skillsLoaded: getSkills().filter((k) => k.enabled).map((k) => k.name),
    },
    null,
    2,
  );
}

/** Run one tool call from an agent. */
export async function callTool(name: string, raw: unknown): Promise<ToolResult> {
  const a = (raw && typeof raw === "object" ? raw : {}) as Args;
  const mode = getChat().mode;

  if (name === "get_context") return { text: context() };
  if (name === "get_document") {
    const d = currentDoc();
    return { text: JSON.stringify({ rootIds: d.rootIds, elements: d.elements }) };
  }
  if (name === "select_elements") {
    const bad = missing(a.ids);
    if (bad.length) return fail(`No element with id: ${bad.join(", ")}.`);
    select(a.ids as string[]);
    return { text: "Selected." };
  }

  if (!EDITS.has(name) && !RISKY.has(name)) return fail(`Unknown tool ${name}.`);
  const check = prepare(name, a);
  if ("error" in check) return fail(check.error);
  const summary = summarise(name, check.args);

  if (mode === "suggest") {
    addMsg({ role: "note", text: "", proposal: { tool: name, args: check.args, summary, status: "open" } });
    return { text: "Suggestion shown to the designer. Nothing has been changed yet. Do not repeat it. Tell the designer in plain words what you suggested." };
  }
  if (RISKY.has(name) && mode === "ask") {
    const ok = await askDesigner(summary);
    if (!ok) return fail("The designer said not now. Do not delete this.");
  }
  return apply(name, check.args);
}
