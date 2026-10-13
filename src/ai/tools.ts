import { outline } from "./outline";
import { componentsIn } from "../document/components";
import { lookAtDesign, lookAtImage } from "./vision";
import { lookAtAttachment } from "./pictures";
import { commandLabel, newId } from "../commands";
import type { CommandName } from "../commands";
import { measureText } from "../canvas/text";
import { canMask, canTurn } from "../document/geometry";
import { outlineFromData } from "../document/path";
import type { El } from "../document/types";
import { invoke } from "@tauri-apps/api/core";
import { addPicture, mimeFor } from "../project/assets";
import { saveNow } from "../project/project";
import { tracePicture } from "../project/trace";
import { currentDoc, dispatch, getState, goTo, select } from "../state/store";
import { addMsg, askDesigner, getChat, setMinimized, updateMsg } from "./chat";
import { outsideRules, skillsText } from "./rules";
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
  /** A picture to show the AI, as base64. */
  image?: { data: string; mime: string };
  isError?: boolean;
}

const str = { type: "string" };
const num = { type: "number" };
const ids = { type: "array", items: str, description: "Element ids, from get_document." };
const props = {
  type: "object",
  description:
    "Any of: name, x, y, width, height (numbers, in pixels), fill (hex colour like #1b1b1f), stroke (hex colour, or null for none), strokeWidth, radius (corner radius), opacity (0 to 1), component (true to make this something that can be reused: place copies of it with create_instance, and changing it changes every copy), rotation (degrees, clockwise, around its own middle; on a group it turns everything inside together; frames and copies of components cannot be turned), d (a path only: redraw its outline, as SVG path text measured from the corner of its parent frame), text, fontSize, fontFamily (any installed font name, or empty for the system font), fontWeight (300 to 900, 400 is regular, 700 is bold), textAlign (left, center or right), lineHeight (a multiple of the size, like 1.4), letterSpacing (pixels), textFixed (true to keep the width and wrap words), shadow ({x, y, blur, color} or null), gradient ({from, to, angle in degrees, 90 runs top to bottom} or null, replaces the fill), link (id of a frame to open when this is clicked in Present mode, or null), linkKind (empty to go to that screen, overlay to open it on top, back to go back), transition (empty, dissolve, push-left, push-right, push-up or push-down), transitionMs (milliseconds, 300 if 0), scroll (on a screen: true so that what is below its bottom edge can be scrolled in Present mode), layout (frames only: auto layout that lines up the children, as {dir is row or column, gap, padX, padY, align is start, center, end or stretch, justify is start, center, end or between, hug true or false}, or null to turn it off; children are placed in their layer order), locked (true to stop it being picked on the canvas), grow (inside an auto layout frame: 1 to fill the free space along the direction, 0 to keep its size).",
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_context",
    description:
      "Start here. Returns the project, what the designer has selected, the frames on the page, the permission level, and which skills are loaded.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_working_rules",
    description:
      "How to work in Duet, and the skills the designer has turned on, in full. For an AI connected from outside Duet's own chat: call it once before your first change in a job. Duet's own chat already gives you this, so do not call it from there.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_outline",
    description:
      "A short outline of the design: every thing with its id, position, size, and the few properties that matter, indented to show what is inside what. Much cheaper to read than get_document, so use this first. Pass ids to outline only those things and what is inside them.",
    inputSchema: { type: "object", properties: { ids } },
  },
  {
    name: "get_document",
    description:
      "The full, exact data for every element on the page. It is large, so prefer get_outline and use this only when you need a property the outline does not show. x and y are relative to the parent frame, or to the page for top-level things. Order in childIds and rootIds goes back to front.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "look_at_image",
    description:
      "See a picture the designer placed on the canvas (type image in get_document). You cannot see pictures unless you call this, and you must not guess what is in one. The picture is shrunk first, so call it once per picture and then work from what you saw. maxSize is the longest side in pixels (default 768).",
    inputSchema: { type: "object", properties: { id: str, maxSize: num }, required: ["id"] },
  },
  {
    name: "look_at_attachment",
    description:
      "See a picture the designer attached to a chat message, such as a screenshot of feedback or a reference. get_context lists them as attachedPictures, each with a number. They are not on the canvas. Look at each new one once, before you act on the message it came with.",
    inputSchema: { type: "object", properties: { number: { type: "number", description: "The picture's number from attachedPictures." } }, required: ["number"] },
  },
  {
    name: "look_at_design",
    description:
      "See what a frame or shape looks like right now, drawn as the designer sees it. Use it to check your own work after changes, and to understand a design before you change it. Leave ids out to see the selection, or the first frame. maxSize is the longest side in pixels (default 768).",
    inputSchema: { type: "object", properties: { ids, maxSize: num } },
  },
  {
    name: "create_instance",
    description:
      "Place a live copy of a component (listed as components in get_context). The copy follows the original. To change one copy, use set_props on things inside it; to change every copy, change the original.",
    inputSchema: {
      type: "object",
      properties: { componentId: str, x: num, y: num, parentId: { type: "string", description: "A frame to put it in. Leave out for the page." } },
      required: ["componentId", "x", "y"],
    },
  },
  {
    name: "select_elements",
    description: "Select elements so the designer can see which things you are talking about. Pass an empty list to clear.",
    inputSchema: { type: "object", properties: { ids }, required: ["ids"] },
  },
  {
    name: "create_element",
    description:
      "Add a frame, rectangle, ellipse, text or path. x and y are relative to parentId (a frame), or to the page when parentId is left out. For text, put the words in props.text and leave width and height out so they fit the words. A path is any shape you draw yourself, like a leaf, a petal, a wave or an arch: give its outline in d and leave width and height out. A closed outline (ending in Z) is filled with props.fill; set props.stroke to null for a flat shape with no line around it. A path is one unbroken outline with no holes, so use several paths for several pieces.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["frame", "rect", "ellipse", "text", "path"] },
        x: num,
        y: num,
        width: num,
        height: num,
        d: {
          ...str,
          description:
            "For a path: the outline as SVG path text, like M 0 0 C 30 -40 70 -40 100 0 C 70 40 30 40 0 0 Z. M, L, H, V, C, S, Q, T, A and Z work, in capital or small letters. The numbers are pixels measured from x, y, so you can draw a shape once around 0 0 and place it anywhere.",
        },
        parentId: { ...str, description: "A frame to put it in. Leave out for the page." },
        props,
      },
      required: ["type", "x", "y"],
    },
  },
  {
    name: "place_image",
    description:
      "Put a picture file from this computer onto the canvas, such as a photo or a reference the designer told you about. path is the full path to a PNG, JPG, GIF, WebP or SVG file (~ for the home folder works). Leave width and height out to keep its shape at up to 640 pixels on the longer side, or give one of them to set the size and keep the shape. The designer may be asked to allow it. You still cannot see the picture: call look_at_image with the new id if you need to.",
    inputSchema: {
      type: "object",
      properties: {
        path: str,
        x: num,
        y: num,
        width: num,
        height: num,
        parentId: { ...str, description: "A frame to put it in. Leave out for the page." },
        name: { ...str, description: "What to call it in the layers list. Leave out to use the file name." },
      },
      required: ["path", "x", "y"],
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
    name: "trace_image",
    description:
      "Turn a picture on the canvas into flat drawn shapes that follow its outline, laid exactly over it, so a leaf, a logo or a silhouette becomes something you can recolour, reshape and turn. It works only on pictures with a plain or see-through background. Each separate part becomes one path in its average colour, and holes are filled in. The picture stays where it is. Look at the picture first if you are not sure it is suitable.",
    inputSchema: { type: "object", properties: { id: { ...str, description: "The picture to trace." } }, required: ["id"] },
  },
  {
    name: "make_mask",
    description:
      "Show things only inside a shape, for example a photo cut to the outline of a leaf or a circle. shapeId is a rectangle, an ellipse or a closed path. ids are the things to show through it, such as pictures. They must all sit in the same frame as the shape. They are put together in a group. The shape is no longer drawn, it only decides where the others show. Move or resize a thing inside the group to change which part of it shows.",
    inputSchema: { type: "object", properties: { shapeId: { ...str, description: "The shape to show them through." }, ids }, required: ["shapeId", "ids"] },
  },
  {
    name: "delete_elements",
    description: "Delete elements and everything inside them. The designer may be asked to approve this.",
    inputSchema: { type: "object", properties: { ids }, required: ["ids"] },
  },
];

const EDITS = new Set(["create_instance", "create_element", "set_props", "move_elements", "resize_element", "reparent_elements", "make_mask", "trace_image"]);
/** Things the designer is asked about first in Ask first mode: losing work, and reading a file from the computer. */
const RISKY = new Set(["delete_elements", "place_image"]);

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
      if (a.type === "path") return "Draw a shape";
      return `Add a ${a.type === "rect" ? "rectangle" : String(a.type)}${p.text ? ` that says "${p.text}"` : ""}`;
    }
    case "create_instance":
      return `Place a copy of ${nameOf(a.componentId)}`;
    case "place_image":
      return `Bring in the picture at ${String(a.path)}`;
    case "trace_image":
      return `Trace ${nameOf(a.id)} into shapes`;
    case "make_mask":
      return `Show ${namesOf(a.ids)} only inside ${nameOf(a.maskId ?? a.shapeId)}`;
    case "set_props": {
      const p = (a.props ?? {}) as Record<string, unknown>;
      // a new outline is a long list of points: say what it is instead of spelling it out
      if ("nodes" in p || "d" in p) return `Redraw the shape of ${namesOf(a.ids)}`;
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
      if (!["frame", "rect", "ellipse", "text", "path"].includes(String(a.type))) return { error: "type must be frame, rect, ellipse, text or path." };
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
      } else if (a.type === "path") {
        try {
          // the outline is measured from x, y; the path's own box is fitted around it
          const shape = outlineFromData(a.d as string);
          a.x = a.x + shape.x;
          a.y = a.y + shape.y;
          a.width = typeof a.width === "number" ? a.width : shape.width;
          a.height = typeof a.height === "number" ? a.height : shape.height;
          p.nodes = shape.nodes;
          p.closed = shape.closed;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      } else {
        const fallback = a.type === "frame" ? { w: 360, h: 640 } : { w: 120, h: 120 };
        a.width = typeof a.width === "number" ? a.width : fallback.w;
        a.height = typeof a.height === "number" ? a.height : fallback.h;
      }
      if ("rotation" in p && (typeof p.rotation !== "number" || a.type === "frame")) return { error: a.type === "frame" ? "A frame cannot be turned." : "rotation must be a number of degrees." };
      delete a.d;
      a.props = p;
      a.id = newId(String(a.type));
      return { args: a };
    }
    case "place_image": {
      const path = typeof a.path === "string" ? a.path.trim() : "";
      if (!path) return { error: "path must be the full path to a picture file." };
      if (!/^(~[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(path)) return { error: "Give the full path to the file, starting from the top folder or from ~ for the home folder." };
      if (!mimeFor(path)) return { error: "That is not a picture Duet can use. It takes PNG, JPG, GIF, WebP and SVG files." };
      if (typeof a.x !== "number" || typeof a.y !== "number") return { error: "x and y must be numbers." };
      for (const k of ["width", "height"]) if (a[k] != null && !(typeof a[k] === "number" && (a[k] as number) > 0)) return { error: `${k} must be a number above 0.` };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      a.path = path;
      a.parentId = a.parentId ?? null;
      a.id = newId("image");
      return { args: a };
    }
    case "create_instance": {
      const main = typeof a.componentId === "string" ? doc.elements[a.componentId] : undefined;
      if (!main || !main.component) return { error: `${String(a.componentId)} is not a component. get_context lists the components.` };
      if (typeof a.x !== "number" || typeof a.y !== "number") return { error: "x and y must be numbers." };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      a.parentId = a.parentId ?? null;
      a.id = newId("instance");
      return { args: a };
    }
    case "set_props": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}. Use get_document to see the ids.` };
      if (!a.props || typeof a.props !== "object") return { error: "props must be an object." };
      const p: Record<string, unknown> = { ...(a.props as Record<string, unknown>) };
      for (const forbidden of ["id", "type", "parentId", "childIds", "componentId", "overrides"]) delete p[forbidden];
      const list = a.ids as string[];
      if ("component" in p) {
        if (p.component !== true) return { error: "component can only be set to true. To stop something being a component, ask the designer." };
        const not = list.filter((i) => doc.elements[i].type === "instance" || i.includes("::"));
        if (not.length) return { error: `${namesOf(not)} is a copy of a component, so it cannot be made into one.` };
      }
      if ("rotation" in p) {
        if (typeof p.rotation !== "number") return { error: "rotation must be a number of degrees." };
        const fixed = list.filter((i) => !canTurn(doc, i));
        if (fixed.length) return { error: `${namesOf(fixed)} cannot be turned. Frames and copies of components stay upright. Turn the things inside instead.` };
      }
      if ("d" in p) {
        if (list.length !== 1 || doc.elements[list[0]].type !== "path") return { error: "d redraws one path at a time. Give the id of one path." };
        try {
          const { closed, ...shape } = outlineFromData(p.d as string);
          delete p.d;
          Object.assign(p, shape, { closed });
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
      // text that changes size should resize to fit, unless the agent said otherwise
      if (list.length === 1 && doc.elements[list[0]].type === "text" && ("text" in p || "fontSize" in p) && !("width" in p)) {
        const el = doc.elements[list[0]];
        const m = measureText(String(p.text ?? el.text), Number(p.fontSize ?? el.fontSize));
        p.width = m.width + 2;
        p.height = m.height;
      }
      a.props = p;
      return { args: a };
    }
    case "trace_image": {
      const el = typeof a.id === "string" ? doc.elements[a.id] : undefined;
      if (!el) return { error: `No element with id: ${String(a.id)}.` };
      if (el.type !== "image") return { error: `${el.name} is not a picture. Only pictures can be traced.` };
      return { args: { id: el.id } };
    }
    case "make_mask": {
      const shape = typeof a.shapeId === "string" ? doc.elements[a.shapeId] : undefined;
      if (!shape) return { error: `No element with id: ${String(a.shapeId)}.` };
      if (!canMask(shape)) return { error: `${shape.name} cannot be a mask. Use a rectangle, an ellipse or a closed path.` };
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      const list = (a.ids as string[]).filter((i) => i !== shape.id);
      if (list.length === 0) return { error: "Give at least one thing to show inside the shape." };
      const apart = list.filter((i) => (doc.elements[i].parentId ?? null) !== (shape.parentId ?? null));
      if (apart.length) return { error: `${namesOf(apart)} must be in the same frame as ${shape.name} first. Use reparent_elements.` };
      return { args: { maskId: shape.id, ids: list, groupId: newId("group") } };
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

/** Longest side of a picture the AI brings in, unless it asks for a size. Same as a picture the designer drops in. */
const PICTURE_SIDE = 640;

/** Read a picture file from the computer, keep it in the project, and put it on the canvas. */
async function placeImage(args: Args): Promise<ToolResult> {
  const file = String(args.path).split(/[\\/]/).pop() ?? "Image";
  let pic: { src: string; width: number; height: number };
  try {
    let path = String(args.path);
    if (path.startsWith("~")) {
      // Duet's own folder sits in the home folder, which is how the home folder is found
      const home = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[\\/]?$/, "");
      path = home + path.slice(1);
    }
    const bin = atob(await invoke<string>("read_binary_file", { path }));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    pic = await addPicture(file, bytes);
  } catch {
    return fail(`The picture at ${String(args.path)} could not be read. Check the path, and that the file is a picture.`);
  }
  const shape = pic.width / pic.height;
  let width: number;
  let height: number;
  if (typeof args.width === "number" && typeof args.height === "number") [width, height] = [args.width, args.height];
  else if (typeof args.width === "number") [width, height] = [args.width, args.width / shape];
  else if (typeof args.height === "number") [width, height] = [args.height * shape, args.height];
  else {
    const k = Math.min(1, PICTURE_SIDE / Math.max(pic.width, pic.height));
    [width, height] = [pic.width * k, pic.height * k];
  }
  width = Math.max(8, Math.round(width));
  height = Math.max(8, Math.round(height));
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : file.replace(/\.[^.]+$/, "") || "Image";
  await ensureSaved();
  dispatch("create_element", { type: "image", id: String(args.id), parentId: args.parentId as string | null, x: Number(args.x), y: Number(args.y), width, height, props: { src: pic.src, name } }, "ai");
  if (!currentDoc().elements[String(args.id)]) return fail("The picture could not be placed there.");
  addMsg({ role: "note", text: `Brought in the picture ${file}`, ...stepNow() });
  void saveNow();
  return { text: `Placed the picture as ${String(args.id)} named "${name}", ${width} by ${height} (the file is ${pic.width} by ${pic.height}). Call look_at_image to see it.` };
}

/** The step a change has just made: where it is for Undo, and its name so the words stay tied to it. */
function stepNow() {
  const s = getState();
  return { undoStep: s.cursor, step: s.timeline[s.cursor].step };
}

/** Trace a picture into shapes, as one step the designer can undo. */
async function traceImage(args: Args): Promise<ToolResult> {
  await ensureSaved();
  const name = nameOf(args.id);
  const result = await tracePicture(String(args.id), "ai");
  if ("why" in result) return fail(result.why);
  addMsg({ role: "note", text: `Traced ${name} into shapes`, ...stepNow() });
  void saveNow();
  const where = result.groupId ? `, together in the group ${result.groupId}` : "";
  return { text: `Made ${result.ids.length} ${result.ids.length === 1 ? "path" : "paths"}: ${result.ids.join(", ")}${where}. They sit exactly over the picture, which is still there. Change their fill with set_props.` };
}

async function apply(tool: string, args: Args): Promise<ToolResult> {
  if (tool === "place_image") return placeImage(args);
  if (tool === "trace_image") return traceImage(args);
  await ensureSaved();
  const label = commandLabel(tool as CommandName, args as never);
  dispatch(tool as CommandName, args as never, "ai");
  addMsg({ role: "note", text: summarise(tool, args), ...stepNow() });
  void saveNow();
  if (tool === "create_instance") return { text: `Placed a copy with id ${String(args.id)}. Its parts have ids that start with "${String(args.id)}::". Change them with set_props to change this copy only.` };
  if (tool === "make_mask") {
    if (!currentDoc().elements[String(args.groupId)]) return fail("That mask could not be made.");
    return { text: `Made the mask group ${String(args.groupId)}. It is as big as the shape. Its things kept their ids.` };
  }
  if (tool === "create_element") {
    const el = currentDoc().elements[String(args.id)];
    const box = el?.type === "path" ? ` Its box sits at ${Math.round(el.x)},${Math.round(el.y)} and is ${Math.round(el.width)} by ${Math.round(el.height)}.` : "";
    return { text: `Created ${String(args.id)} named "${el?.name}" (${label}).${box}` };
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
      components: componentsIn(doc).map((c) => ({ id: c.id, name: c.name, width: c.width, height: c.height })),
      elementCount: Object.keys(doc.elements).length,
      units: "pixels. x and y are relative to the parent frame, or to the page for top-level things.",
      skillsLoaded: getSkills().filter((k) => k.enabled).map((k) => k.name),
      // pictures given with chat messages; "waiting" ones sit in the message box and have not been sent yet
      attachedPictures: getChat().pictures.map((p) => ({ number: p.n, name: p.name, waiting: !p.sent })),
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
  if (name === "get_working_rules") return { text: `${outsideRules()}\n\n${skillsText()}` };
  if (name === "get_outline") return { text: outline(currentDoc(), Array.isArray(a.ids) ? (a.ids as unknown[]).map(String) : undefined) };
  if (name === "get_document") {
    const d = currentDoc();
    return { text: JSON.stringify({ rootIds: d.rootIds, elements: d.elements }) };
  }
  if (name === "look_at_image") return lookAtImage(a.id, a.maxSize);
  if (name === "look_at_design") return lookAtDesign(a.ids, a.maxSize);
  if (name === "look_at_attachment") return lookAtAttachment(a.number);
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
    setMinimized(false);
    return { text: "Suggestion shown to the designer. Nothing has been changed yet. Do not repeat it. Tell the designer in plain words what you suggested." };
  }
  if (RISKY.has(name) && mode === "ask") {
    const ok = await askDesigner(summary);
    if (!ok) return fail(name === "place_image" ? "The designer said not now. Do not bring this file in." : "The designer said not now. Do not delete this.");
  }
  return apply(name, check.args);
}
