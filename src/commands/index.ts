import { descendants } from "../document/geometry";
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

// ---- registry ----
export const commands = {
  create_element: createElement,
  move_elements: moveElements,
  resize_element: resizeElement,
  set_props: setProps,
  delete_elements: deleteElements,
} as const;

export type CommandName = keyof typeof commands;

type ArgsOf<N extends CommandName> = (typeof commands)[N] extends CommandDef<infer A> ? A : never;

export function runCommand<N extends CommandName>(doc: Doc, name: N, args: ArgsOf<N>): Doc {
  return (commands[name] as CommandDef<ArgsOf<N>>).run(doc, args);
}

export function commandLabel<N extends CommandName>(name: N, args: ArgsOf<N>): string {
  return (commands[name] as CommandDef<ArgsOf<N>>).label(args);
}
