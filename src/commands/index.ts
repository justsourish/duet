import { fitText } from "../canvas/text";
import type { ClipPayload } from "../document/clipboard";
import { descendants, worldPos } from "../document/geometry";
import { captureOverrides, detachInstance, isDerived, syncInstances } from "../document/components";
import { orderByPosition, relayout } from "../document/layout";
import type { Doc, El, ElementType, Layout, TextStyle } from "../document/types";

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
  image: { fill: "#d9d9de", radius: 0 },
  path: { fill: "#d9d9de", stroke: "#1b1b1f", strokeWidth: 2, radius: 0 },
  group: { fill: "#00000000", radius: 0 },
  instance: { fill: "#ffffff", radius: 0 },
};

const typeName: Record<ElementType, string> = {
  frame: "Frame",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  image: "Image",
  path: "Path",
  group: "Group",
  instance: "Component",
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
    // only frames can hold things, and the inside of a copy is made from its component
    if (a.parentId && (doc.elements[a.parentId]?.type !== "frame" || isDerived(a.parentId))) return doc;
    const next = clone(doc);
    const id = a.id ?? newId(a.type);
    const parentId = a.parentId ?? null;
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
      fontFamily: "",
      fontWeight: 400,
      textAlign: "left",
      lineHeight: 0,
      letterSpacing: 0,
      textFixed: false,
      textStyleId: "",
      shadow: null,
      gradient: null,
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      src: "",
      component: false,
      componentId: "",
      overrides: {},
      locked: false,
      layout: null,
      grow: 0,
      nodes: [],
      closed: false,
      childIds: [],
      ...defaults[a.type],
      ...a.props,
    };
    if (el.type === "text" && a.props && TEXT_LOOK.some((k) => k in a.props!)) {
      const m = fitText(el);
      el.width = m.width;
      el.height = m.height;
    }
    next.elements[id] = el;
    if (parentId) next.elements[parentId].childIds.push(id);
    else next.rootIds.push(id);
    orderByPosition(next, parentId);
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
    // in an auto layout frame, moving a child past its neighbours changes the order
    for (const pid of new Set(a.ids.map((id) => next.elements[id]?.parentId))) orderByPosition(next, pid ?? null);
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
    if (el.type === "group") {
      // a group has no size of its own: resizing it scales everything inside it
      const sx = Math.max(1, a.width) / Math.max(1, el.width);
      const sy = Math.max(1, a.height) / Math.max(1, el.height);
      for (const id of descendants(next, a.id)) {
        const d = next.elements[id];
        d.width = Math.max(1, d.width * sx);
        d.height = Math.max(1, d.height * sy);
        d.x *= sx;
        d.y *= sy;
      }
      el.x = a.x;
      el.y = a.y;
      return next;
    }
    el.x = a.x;
    el.y = a.y;
    el.width = Math.max(1, a.width);
    el.height = Math.max(1, a.height);
    if (el.type === "text") {
      // pulling a text box wider or narrower sets its width, and the words wrap inside it
      if (Math.abs(el.width - doc.elements[a.id].width) > 0.5) el.textFixed = true;
      el.height = fitText(el).height;
    }
    // sizing a frame by hand means it no longer hugs its content
    if (el.layout?.hug && (el.width !== doc.elements[a.id].width || el.height !== doc.elements[a.id].height)) el.layout = { ...el.layout, hug: false };
    return next;
  },
};

// ---- set_props ----
export interface SetPropsArgs {
  ids: string[];
  props: Partial<Omit<El, "id" | "type" | "parentId" | "childIds">>;
  label?: string;
}

const TEXT_LOOK = ["text", "fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing", "textFixed"];

const setProps: CommandDef<SetPropsArgs> = {
  label: (a) => a.label ?? "Change properties",
  run: (doc, a) => {
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      Object.assign(el, a.props);
      // text that changes how it looks or what it says gets the size it needs, unless the size was given
      if (el.type === "text" && TEXT_LOOK.some((k) => k in a.props) && !("width" in a.props) && !("height" in a.props)) {
        const m = fitText(el);
        el.width = m.width;
        el.height = m.height;
      }
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
      if (!el || isDerived(id)) continue; // the inside of a copy comes from its component
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
      if (!target || target.type !== "frame" || isDerived(target.id)) return doc;
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
    orderByPosition(next, a.parentId);
    return next;
  },
};

// ---- paste_elements ----
export interface PasteArgs {
  payload: ClipPayload;
  /** A frame to paste into, or null for the page. */
  parentId: string | null;
  /** Move the pasted pieces by this much from where they were copied. */
  dx?: number;
  dy?: number;
  /** New ids for the pasted pieces, if the caller needs to know them. */
  idMap?: Record<string, string>;
  label?: string;
}

/** Make new copies of copied elements. Links between copied pieces are kept inside the copy. */
const pasteElements: CommandDef<PasteArgs> = {
  label: (a) => a.label ?? (a.payload.rootIds.length > 1 ? `Paste ${a.payload.rootIds.length} elements` : "Paste"),
  run: (doc, a) => {
    if (a.parentId && (doc.elements[a.parentId]?.type !== "frame" || isDerived(a.parentId))) return doc;
    const next = clone(doc);
    const idMap: Record<string, string> = { ...(a.idMap ?? {}) };
    for (const [oldId, el] of Object.entries(a.payload.elements)) if (!isDerived(oldId)) idMap[oldId] ??= newId(el.type);
    const parentWorld = a.parentId ? worldPos(next, a.parentId) : { x: 0, y: 0 };
    const list = a.parentId ? next.elements[a.parentId].childIds : next.rootIds;
    for (const [oldId, el] of Object.entries(a.payload.elements)) {
      if (isDerived(oldId)) continue; // a copy of an instance gets its inside from the component
      const copy: El = structuredClone(el);
      copy.id = idMap[oldId];
      copy.childIds = el.type === "instance" ? [] : el.childIds.filter((c) => idMap[c]).map((c) => idMap[c]);
      copy.link = el.link && idMap[el.link] ? idMap[el.link] : el.link && next.elements[el.link] ? el.link : null;
      if (a.payload.rootIds.includes(oldId)) {
        const o = a.payload.origins[oldId];
        copy.parentId = a.parentId;
        copy.x = o.x - parentWorld.x + (a.dx ?? 0);
        copy.y = o.y - parentWorld.y + (a.dy ?? 0);
        list.push(copy.id);
      } else {
        copy.parentId = el.parentId ? idMap[el.parentId] : null;
      }
      next.elements[copy.id] = copy;
    }
    return next;
  },
};

// ---- text styles ----
const TEXT_FACE = ["fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing"] as const;

function restyle(doc: Doc, styleId: string) {
  const st = doc.styles?.[styleId];
  if (!st) return;
  for (const el of Object.values(doc.elements)) {
    if (el.type !== "text" || el.textStyleId !== styleId) continue;
    for (const k of TEXT_FACE) (el as unknown as Record<string, unknown>)[k] = st[k];
    const m = fitText(el);
    el.width = m.width;
    el.height = m.height;
  }
}

export interface CreateTextStyleArgs {
  styleId: string;
  fromId: string;
  name: string;
}

const createTextStyle: CommandDef<CreateTextStyleArgs> = {
  label: (a) => `Save text style ${a.name}`,
  run: (doc, a) => {
    const el = doc.elements[a.fromId];
    if (!el || el.type !== "text") return doc;
    const next = clone(doc);
    const style: TextStyle = { name: a.name.trim() || "Text style", fontFamily: el.fontFamily, fontWeight: el.fontWeight, fontSize: el.fontSize, lineHeight: el.lineHeight, letterSpacing: el.letterSpacing };
    next.styles = { ...(next.styles ?? {}), [a.styleId]: style };
    next.elements[a.fromId].textStyleId = a.styleId;
    return next;
  },
};

export interface ApplyTextStyleArgs {
  ids: string[];
  styleId: string | null;
}

const applyTextStyle: CommandDef<ApplyTextStyleArgs> = {
  label: (a) => (a.styleId ? "Use a text style" : "Detach from the text style"),
  run: (doc, a) => {
    if (a.styleId && !doc.styles?.[a.styleId]) return doc;
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (el?.type === "text") el.textStyleId = a.styleId ?? "";
    }
    if (a.styleId) restyle(next, a.styleId);
    return next;
  },
};

export interface UpdateTextStyleArgs {
  styleId: string;
  props: Partial<Omit<TextStyle, never>>;
}

const updateTextStyle: CommandDef<UpdateTextStyleArgs> = {
  label: (a) => `Change text style ${a.props.name ?? ""}`.trim(),
  run: (doc, a) => {
    if (!doc.styles?.[a.styleId]) return doc;
    const next = clone(doc);
    next.styles = { ...next.styles, [a.styleId]: { ...next.styles![a.styleId], ...a.props } };
    restyle(next, a.styleId);
    return next;
  },
};

export interface DeleteTextStyleArgs {
  styleId: string;
}

const deleteTextStyle: CommandDef<DeleteTextStyleArgs> = {
  label: () => "Delete text style",
  run: (doc, a) => {
    if (!doc.styles?.[a.styleId]) return doc;
    const next = clone(doc);
    const { [a.styleId]: _gone, ...rest } = next.styles!;
    void _gone;
    next.styles = rest;
    for (const el of Object.values(next.elements)) if (el.textStyleId === a.styleId) el.textStyleId = "";
    return next;
  },
};

// ---- components ----
export interface CreateComponentArgs {
  id: string;
}

const createComponent: CommandDef<CreateComponentArgs> = {
  label: () => "Make a component",
  run: (doc, a) => {
    const el = doc.elements[a.id];
    if (!el || isDerived(a.id) || (el.type !== "frame" && el.type !== "group") || el.component) return doc;
    const next = clone(doc);
    next.elements[a.id].component = true;
    return next;
  },
};

export interface CreateInstanceArgs {
  componentId: string;
  id: string;
  x: number;
  y: number;
  parentId?: string | null;
}

const createInstance: CommandDef<CreateInstanceArgs> = {
  label: (a) => `Add ${a.componentId ? "a copy of a component" : "an instance"}`,
  run: (doc, a) => {
    const main = doc.elements[a.componentId];
    if (!main || !main.component) return doc;
    if (a.parentId && (doc.elements[a.parentId]?.type !== "frame" || isDerived(a.parentId))) return doc;
    // never put a component inside itself
    let p: string | null | undefined = a.parentId ?? null;
    while (p) {
      if (p === main.id) return doc;
      p = doc.elements[p]?.parentId;
    }
    const next = clone(doc);
    const el: El = {
      ...structuredClone(main),
      id: a.id,
      type: "instance",
      name: main.name,
      parentId: a.parentId ?? null,
      x: a.x,
      y: a.y,
      component: false,
      componentId: main.id,
      overrides: {},
      childIds: [],
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      locked: false,
      grow: 0,
    };
    next.elements[a.id] = el;
    if (a.parentId) next.elements[a.parentId].childIds.push(a.id);
    else next.rootIds.push(a.id);
    return next;
  },
};

export interface DetachArgs {
  id: string;
}

const detachCommand: CommandDef<DetachArgs> = {
  label: () => "Detach from component",
  run: (doc, a) => detachInstance(doc, a.id),
};

export interface ResetArgs {
  id: string;
}

const resetOverrides: CommandDef<ResetArgs> = {
  label: () => "Reset to the component",
  run: (doc, a) => {
    if (doc.elements[a.id]?.type !== "instance") return doc;
    const next = clone(doc);
    next.elements[a.id].overrides = {};
    return next;
  },
};

// ---- set_layout ----
export interface SetLayoutArgs {
  id: string;
  layout: Layout | null;
}

const setLayout: CommandDef<SetLayoutArgs> = {
  label: (a) => (a.layout ? "Turn on auto layout" : "Turn off auto layout"),
  run: (doc, a) => {
    if (doc.elements[a.id]?.type !== "frame") return doc;
    const next = clone(doc);
    next.elements[a.id].layout = a.layout;
    orderByPosition(next, a.id); // the children keep the order they sit in
    return next;
  },
};

// ---- wrap_in_layout ----
export interface WrapArgs {
  ids: string[];
  frameId: string;
}

const wrapInLayout: CommandDef<WrapArgs> = {
  label: () => "Add auto layout",
  run: (doc, a) => {
    const els = a.ids.map((id) => doc.elements[id]).filter(Boolean);
    if (els.length === 0) return doc;
    const parentId = els[0].parentId;
    if (!els.every((e) => e.parentId === parentId)) return doc;
    const next = clone(doc);
    const list = parentId ? next.elements[parentId].childIds : next.rootIds;
    const x = Math.min(...els.map((e) => e.x));
    const y = Math.min(...els.map((e) => e.y));
    const w = Math.max(...els.map((e) => e.x + e.width)) - x;
    const h = Math.max(...els.map((e) => e.y + e.height)) - y;
    const at = Math.min(...els.map((e) => list.indexOf(e.id)).filter((i) => i >= 0));
    const frame: El = {
      id: a.frameId,
      type: "frame",
      name: nextName(doc, "frame"),
      parentId,
      x,
      y,
      width: w,
      height: h,
      fill: "#ffffff00",
      stroke: null,
      strokeWidth: 1,
      radius: 0,
      opacity: 1,
      text: "",
      fontSize: 16,
      fontFamily: "",
      fontWeight: 400,
      textAlign: "left",
      lineHeight: 0,
      letterSpacing: 0,
      textFixed: false,
      textStyleId: "",
      shadow: null,
      gradient: null,
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      src: "",
      component: false,
      componentId: "",
      overrides: {},
      locked: false,
      layout: { dir: w >= h ? "row" : "column", gap: 12, padX: 0, padY: 0, align: "start", justify: "start", hug: true },
      grow: 0,
      nodes: [],
      closed: false,
      childIds: [],
    };
    next.elements[frame.id] = frame;
    for (const id of a.ids) {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      const el = next.elements[id];
      el.parentId = frame.id;
      el.x -= x;
      el.y -= y;
      frame.childIds.push(id);
    }
    list.splice(Math.max(0, at), 0, frame.id);
    orderByPosition(next, frame.id);
    return next;
  },
};

// ---- group_elements ----
export interface GroupArgs {
  ids: string[];
  groupId: string;
}

const groupElements: CommandDef<GroupArgs> = {
  label: () => "Group",
  run: (doc, a) => {
    const els = a.ids.map((id) => doc.elements[id]).filter(Boolean);
    if (els.length === 0) return doc;
    const parentId = els[0].parentId;
    if (!els.every((e) => e.parentId === parentId)) return doc;
    const next = clone(doc);
    const list = parentId ? next.elements[parentId].childIds : next.rootIds;
    const x = Math.min(...els.map((e) => e.x));
    const y = Math.min(...els.map((e) => e.y));
    const w = Math.max(...els.map((e) => e.x + e.width)) - x;
    const h = Math.max(...els.map((e) => e.y + e.height)) - y;
    const at = Math.max(...els.map((e) => list.indexOf(e.id)));
    const group: El = {
      id: a.groupId,
      type: "group",
      name: nextName(doc, "group"),
      parentId,
      x,
      y,
      width: w,
      height: h,
      fill: "#00000000",
      stroke: null,
      strokeWidth: 1,
      radius: 0,
      opacity: 1,
      text: "",
      fontSize: 16,
      fontFamily: "",
      fontWeight: 400,
      textAlign: "left",
      lineHeight: 0,
      letterSpacing: 0,
      textFixed: false,
      textStyleId: "",
      shadow: null,
      gradient: null,
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      src: "",
      component: false,
      componentId: "",
      overrides: {},
      locked: false,
      layout: null,
      grow: 0,
      nodes: [],
      closed: false,
      childIds: [],
    };
    next.elements[group.id] = group;
    // keep the stacking order they already had
    const ordered = list.filter((id) => a.ids.includes(id));
    for (const id of ordered) {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      const el = next.elements[id];
      el.parentId = group.id;
      el.x -= x;
      el.y -= y;
      group.childIds.push(id);
    }
    const insertAt = Math.min(list.length, Math.max(0, at - ordered.length + 1));
    list.splice(insertAt, 0, group.id);
    return next;
  },
};

// ---- ungroup ----
export interface UngroupArgs {
  ids: string[];
}

const ungroup: CommandDef<UngroupArgs> = {
  label: () => "Ungroup",
  run: (doc, a) => {
    const groups = a.ids.filter((id) => doc.elements[id]?.type === "group");
    if (groups.length === 0) return doc;
    const next = clone(doc);
    for (const gid of groups) {
      const g = next.elements[gid];
      if (!g) continue;
      const list = g.parentId ? next.elements[g.parentId].childIds : next.rootIds;
      const at = list.indexOf(gid);
      for (const cid of g.childIds) {
        const c = next.elements[cid];
        c.parentId = g.parentId;
        c.x += g.x;
        c.y += g.y;
      }
      list.splice(at, 1, ...g.childIds);
      delete next.elements[gid];
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
  paste_elements: pasteElements,
  set_layout: setLayout,
  wrap_in_layout: wrapInLayout,
  group_elements: groupElements,
  ungroup,
  create_text_style: createTextStyle,
  apply_text_style: applyTextStyle,
  update_text_style: updateTextStyle,
  delete_text_style: deleteTextStyle,
  create_component: createComponent,
  create_instance: createInstance,
  detach_instance: detachCommand,
  reset_overrides: resetOverrides,
} as const;

export type CommandName = keyof typeof commands;

type ArgsOf<N extends CommandName> = (typeof commands)[N] extends CommandDef<infer A> ? A : never;

export function runCommand<N extends CommandName>(doc: Doc, name: N, args: ArgsOf<N>): Doc {
  const out = (commands[name] as CommandDef<ArgsOf<N>>).run(doc, args);
  if (out === doc) return doc;
  // keep what was changed on a copy, rebuild the copies from their components, then line things up
  return relayout(syncInstances(captureOverrides(doc, out)));
}

export function commandLabel<N extends CommandName>(name: N, args: ArgsOf<N>): string {
  return (commands[name] as CommandDef<ArgsOf<N>>).label(args);
}
