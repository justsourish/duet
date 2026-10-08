import { descendants, worldPos } from "../document/geometry";
import type { Doc, El, ElementType } from "../document/types";

/**
 * Every change to a design goes through one of these named commands.
 * The GUI calls them. Later, the AI calls the very same ones.
 * Each command is a pure function: old document in, new document out.
 */

export type Actor = "you" | "ai";

export interface CommandDef<A> {
  run: (doc: Doc, args: A) => Doc;
  label: (args: A) => string;
}

const clone = (doc: Doc): Doc => structuredClone(doc);

let counter = 0;
export const newId = (type: string): string =>
  `${type}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const defaults: Record<ElementType, Partial<El>> = {
  frame: { fill: "#ffffff", radius: 0 },
  rect: { fill: "#d9d9de", radius: 0 },
  ellipse: { fill: "#d9d9de", radius: 0 },
  text: { fill: "#1b1b1f", radius: 0 },
};

const typeName: Record<ElementType, string> = {
  frame: "Frame",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
};

function nextName(doc: Doc, type: ElementType): string {
  const n = Object.values(doc.elements).filter((e) => e.type === type).length + 1;
  return `${typeName[type]} ${n}`;
}

// ---- create_element ----
export interface CreateArgs {
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string | null;
  id?: string;
  props?: Partial<El>;
}

const createElement: CommandDef<CreateArgs> = {
  label: (a) => `Add ${typeName[a.type].toLowerCase()}`,
  run: (doc, a) => {
    const next = clone(doc);
    const id = a.id ?? newId(a.type);
    const parentId = a.parentId && next.elements[a.parentId] ? a.parentId : null;
    const el: El = {
      id,
      type: a.type,
      name: nextName(doc, a.type),
      parentId,
      x: a.x,
      y: a.y,
      width: Math.max(1, a.width),
      height: Math.max(1, a.height),
      fill: "#d9d9de",
      stroke: null,
      strokeWidth: 1,
      radius: 0,
      opacity: 1,
      text: a.type === "text" ? "Text" : "",
      fontSize: 16,
      childIds: [],
      ...defaults[a.type],
      ...a.props,
    };
    next.elements[id] = el;
    if (parentId) next.elements[parentId].childIds.push(id);
    else next.rootIds.push(id);
    return next;
  },
};

// ---- move_elements ----
export interface MoveArgs {
  ids: string[];
  dx: number;
  dy: number;
}

const moveElements: CommandDef<MoveArgs> = {
  label: (a) => (a.ids.length > 1 ? `Move ${a.ids.length} elements` : "Move element"),
  run: (doc, a) => {
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      el.x += a.dx;
      el.y += a.dy;
    }
    return next;
  },
};

// ---- resize_element ----
export interface ResizeArgs {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const resizeElement: CommandDef<ResizeArgs> = {
  label: () => "Resize element",
  run: (doc, a) => {
    const next = clone(doc);
    const el = next.elements[a.id];
    if (!el) return next;
    el.x = a.x;
    el.y = a.y;
    el.width = Math.max(1, a.width);
    el.height = Math.max(1, a.height);
    return next;
  },
};

// ---- set_props ----
export interface SetPropsArgs {
  ids: string[];
  props: Partial<Omit<El, "id" | "type" | "parentId" | "childIds">>;
  label?: string;
}

const setProps: CommandDef<SetPropsArgs> = {
  label: (a) => a.label ?? "Change properties",
  run: (doc, a) => {
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (el) Object.assign(el, a.props);
    }
    return next;
  },
};

// ---- delete_elements ----
export interface DeleteArgs {
  ids: string[];
}

const deleteElements: CommandDef<DeleteArgs> = {
  label: (a) => (a.ids.length > 1 ? `Delete ${a.ids.length} elements` : "Delete element"),
  run: (doc, a) => {
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      for (const d of descendants(next, id)) delete next.elements[d];
      if (el.parentId && next.elements[el.parentId]) {
        const p = next.elements[el.parentId];
        p.childIds = p.childIds.filter((c) => c !== id);
      } else {
        next.rootIds = next.rootIds.filter((c) => c !== id);
      }
      delete next.elements[id];
    }
    return next;
  },
};

// ---- reparent_elements ----
export interface ReparentArgs {
  ids: string[];
  /** New parent frame, or null for the page. */
  parentId: string | null;
  /** Position in the new parent's list. Later means in front. Defaults to the front. */
  index?: number;
  label?: string;
}

/** Move elements into another frame, out of a frame, or to a new place in the stack. Keeps them where they look. */
const reparentElements: CommandDef<ReparentArgs> = {
  label: (a) => a.label ?? "Move to another frame",
  run: (doc, a) => {
    if (a.parentId) {
      const target = doc.elements[a.parentId];
      if (!target || target.type !== "frame") return doc;
      for (const id of a.ids) {
        if (id === a.parentId || descendants(doc, id).includes(a.parentId)) return doc; // would create a loop
      }
    }
    const next = clone(doc);
    const parentWorld = a.parentId ? worldPos(next, a.parentId) : { x: 0, y: 0 };
    const listOf = (pid: string | null) => (pid ? next.elements[pid].childIds : next.rootIds);
    let index = a.index ?? listOf(a.parentId).length;
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      const w = worldPos(next, id);
      const oldList = listOf(el.parentId);
      const from = oldList.indexOf(id);
      if (from >= 0) oldList.splice(from, 1);
      const newList = listOf(a.parentId);
      let at = index;
      if (oldList === newList && from >= 0 && from < index) at -= 1;
      at = Math.max(0, Math.min(newList.length, at));
      newList.splice(at, 0, id);
      el.parentId = a.parentId;
      el.x = w.x - parentWorld.x;
      el.y = w.y - parentWorld.y;
      index = at + 1;
    }
    return next;
  },
};

// ---- registry ----
export const commands = {
  create_element: createElement,
  move_elements: moveElements,
  resize_element: resizeElement,
  set_props: setProps,
  delete_elements: deleteElements,
  reparent_elements: reparentElements,
} as const;

export type CommandName = keyof typeof commands;

type ArgsOf<N extends CommandName> = (typeof commands)[N] extends CommandDef<infer A> ? A : never;

export function runCommand<N extends CommandName>(doc: Doc, name: N, args: ArgsOf<N>): Doc {
  return (commands[name] as CommandDef<ArgsOf<N>>).run(doc, args);
}

export function commandLabel<N extends CommandName>(name: N, args: ArgsOf<N>): string {
  return (commands[name] as CommandDef<ArgsOf<N>>).label(args);
}
