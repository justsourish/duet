import { fitText } from "../canvas/text";
import type { ClipPayload } from "../document/clipboard";
import { ancestors, canMask, canTurn, descendants, tidyAngle, topLevelOnly, turnCentre, turnPoint, worldPos } from "../document/geometry";
import { canBeComponent, captureOverrides, detachInstance, isDerived, syncInstances } from "../document/components";
import { orderByPosition, relayout } from "../document/layout";
import { MOVING, playsFile } from "../document/types";
import type { Doc, El, ElementType, Key, Layout, Moving, ShapeKey, TextStyle } from "../document/types";
import { CURVES, ENTRANCES, entranceKeys, fileTimeAt, outlineOf, sceneOf, spanOf, valueAt, withKey, withShapeKey } from "../document/time";
import type { CurveName, Entrance } from "../document/time";
import { canGrade, mergeGrade } from "../document/grade";
import type { GradeChange } from "../document/grade";
import type { CreatePresetFrameArgs } from "./presets";

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
  video: { fill: "#000000", radius: 0 },
  sound: { fill: "#00000000", radius: 0 },
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
  video: "Clip",
  sound: "Sound",
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
  /** Put it last among its siblings, in the order it was made, instead of where it sits along an auto layout row or column. */
  keepOrder?: boolean;
}

const createElement: CommandDef<CreateArgs> = {
  label: (a) => `Add ${typeName[a.type].toLowerCase()}`,
  run: (doc, a) => {
    // only frames can hold things, and the inside of a copy is made from its component
    if (a.parentId && (doc.elements[a.parentId]?.type !== "frame" || isDerived(a.parentId))) return doc;
    const next = clone(doc);
    const id = a.id ?? newId(a.type);
    const parentId = a.parentId ?? null;
    const parent = parentId ? doc.elements[parentId] : null;
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
      rotation: 0,
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
      grade: null,
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      src: "",
      component: false,
      componentId: "",
      overrides: {},
      mask: false,
      maskFeather: 0,
      maskInvert: false,
      maskGrow: 0,
      locked: false,
      hidden: false,
      layout: null,
      grow: 0,
      nodes: [],
      closed: false,
      duration: 0,
      start: 0,
      end: 0,
      keys: {},
      shapeKeys: [],
      clipFrom: 0,
      volume: 1,
      childIds: [],
      ...defaults[a.type],
      ...(a.type === "frame" && parent?.layout ? { fill: "#ffffff00" } : {}),
      ...a.props,
    };
    if (el.type === "text" && a.props && TEXT_LOOK.some((k) => k in a.props!)) {
      const m = fitText(el);
      el.width = m.width;
      el.height = m.height;
    }
    // frames and copies of components stay upright
    el.rotation = el.type === "frame" || el.type === "instance" ? 0 : tidyAngle(Number(el.rotation) || 0);
    next.elements[id] = el;
    if (parentId) next.elements[parentId].childIds.push(id);
    else next.rootIds.push(id);
    if (!a.keepOrder) orderByPosition(next, parentId);
    return next;
  },
};

// ---- create_elements ----
export interface CreateManyArgs {
  /** In order: a frame comes before the things inside it. */
  items: CreateArgs[];
}

/** Many new things as one step, such as a whole screen built in one go. */
const createElements: CommandDef<CreateManyArgs> = {
  label: (a) => `Add ${a.items.length} things`,
  run: (doc, a) => {
    let next = doc;
    for (const item of a.items) next = createElement.run(next, item);
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

/**
 * Turn a group. A group has no body of its own, so everything inside it is swung around the middle
 * of the group and turned by the same amount.
 */
function turnGroup(doc: Doc, id: string, by: number) {
  const pivot = turnCentre(doc, id);
  for (const d of descendants(doc, id)) {
    const el = doc.elements[d];
    el.rotation = tidyAngle((el.rotation || 0) + by);
    if (el.type === "group") continue;
    const at = worldPos(doc, d);
    const cx = at.x + el.width / 2;
    const cy = at.y + el.height / 2;
    const to = turnPoint(cx, cy, pivot.x, pivot.y, by);
    el.x += to.x - cx;
    el.y += to.y - cy;
  }
}

const setProps: CommandDef<SetPropsArgs> = {
  label: (a) => a.label ?? "Change properties",
  run: (doc, a) => {
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      const was = el.rotation || 0;
      Object.assign(el, a.props);
      if ("rotation" in a.props) {
        // a rotation that changes over time keeps whole turns: 360 is one full spin, and minus turns the other way
        const turn = Number(a.props.rotation) || 0;
        el.rotation = canTurn(next, id) ? (el.keys.rotation?.length ? Math.round(turn * 100) / 100 : tidyAngle(turn)) : was;
        if (el.type === "group" && el.rotation !== was) turnGroup(next, id, el.rotation - was);
      }
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

// ---- set_grade ----
export interface SetGradeArgs {
  ids: string[];
  /** Only the controls to change. null puts the colour back as it was. */
  grade: GradeChange | null;
  label?: string;
}

const setGrade: CommandDef<SetGradeArgs> = {
  label: (a) => a.label ?? (a.grade ? "Change colour" : "Reset colour"),
  run: (doc, a) => {
    const ids = a.ids.filter((id) => doc.elements[id] && canGrade(doc.elements[id]));
    if (!ids.length) return doc;
    const next = clone(doc);
    for (const id of ids) {
      const el = next.elements[id];
      el.grade = a.grade ? mergeGrade(el.grade, a.grade) : null;
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

// ---- arrange_elements ----
export interface ArrangeArgs {
  ids: string[];
  /** Up is one step to the front, top is all the way. Down and bottom go back the same way. */
  to: "up" | "down" | "top" | "bottom";
}

/** Move things in front of or behind the others beside them, keeping the order they had among themselves. */
const arrangeElements: CommandDef<ArrangeArgs> = {
  label: (a) => ({ up: "Bring forward", down: "Send backward", top: "Bring to front", bottom: "Send to back" })[a.to],
  run: (doc, a) => {
    const next = clone(doc);
    let changed = false;
    const parents = new Set(a.ids.filter((id) => next.elements[id]).map((id) => next.elements[id].parentId));
    for (const pid of parents) {
      const list = pid ? next.elements[pid].childIds : next.rootIds;
      const moving = new Set(a.ids.filter((id) => next.elements[id]?.parentId === pid));
      const before = list.join();
      if (a.to === "top" || a.to === "bottom") {
        const rest = list.filter((id) => !moving.has(id));
        const mine = list.filter((id) => moving.has(id));
        list.splice(0, list.length, ...(a.to === "top" ? [...rest, ...mine] : [...mine, ...rest]));
      } else if (a.to === "up") {
        // later in the list is in front: swap each with the one in front of it, front first so they do not leapfrog
        for (let i = list.length - 2; i >= 0; i--) {
          if (moving.has(list[i]) && !moving.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
        }
      } else {
        for (let i = 1; i < list.length; i++) {
          if (moving.has(list[i]) && !moving.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
        }
      }
      if (list.join() !== before) changed = true;
    }
    return changed ? next : doc;
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

// ---- the canvas colour ----
export interface SetBackgroundArgs {
  /** A colour like #f4f1ea, or null for the standard dark one. */
  color: string | null;
}

const setBackground: CommandDef<SetBackgroundArgs> = {
  label: () => "Change the background",
  run: (doc, a) => {
    const color = a.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a.color) ? a.color.toLowerCase() : undefined;
    if (color === doc.background) return doc;
    const next = clone(doc);
    if (color) next.background = color;
    else delete next.background;
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
    if (!canBeComponent(el)) return doc;
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
      hidden: false,
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
      rotation: 0,
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
      grade: null,
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      src: "",
      component: false,
      componentId: "",
      overrides: {},
      mask: false,
      maskFeather: 0,
      maskInvert: false,
      maskGrow: 0,
      locked: false,
      hidden: false,
      layout: { dir: w >= h ? "row" : "column", gap: 12, padX: 0, padY: 0, align: "start", justify: "start", hug: true },
      grow: 0,
      nodes: [],
      closed: false,
      duration: 0,
      start: 0,
      end: 0,
      keys: {},
      shapeKeys: [],
      clipFrom: 0,
      volume: 1,
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
    const ids = topLevelOnly(doc, a.ids.filter((id) => doc.elements[id]));
    if (ids.length === 0) return doc;
    // things picked from different places are grouped at the level they share, where they still look the same
    const chains = ids.map((id) => [...ancestors(doc, id), null]);
    const parentId = chains[0].find((p) => chains.every((c) => c.includes(p))) ?? null;
    const base = parentId ? worldPos(doc, parentId) : { x: 0, y: 0 };
    const pos = Object.fromEntries(ids.map((id) => {
      const w = worldPos(doc, id);
      return [id, { x: w.x - base.x, y: w.y - base.y }];
    }));
    const next = clone(doc);
    const list = parentId ? next.elements[parentId].childIds : next.rootIds;
    const els = ids.map((id) => next.elements[id]);
    const x = Math.min(...els.map((e) => pos[e.id].x));
    const y = Math.min(...els.map((e) => pos[e.id].y));
    const w = Math.max(...els.map((e) => pos[e.id].x + e.width)) - x;
    const h = Math.max(...els.map((e) => pos[e.id].y + e.height)) - y;
    // where each picked thing sits in the shared list: itself, or the frame or group that holds it
    const branch = (id: string) => [id, ...ancestors(doc, id)].find((b) => list.includes(b))!;
    const top = ids.reduce((best, id) => (list.indexOf(branch(id)) > list.indexOf(branch(best)) ? id : best), ids[0]);
    const topBranch = branch(top);
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
      rotation: 0,
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
      grade: null,
      link: null,
      linkKind: "",
      transition: "",
      transitionMs: 0,
      scroll: false,
      src: "",
      component: false,
      componentId: "",
      overrides: {},
      mask: false,
      maskFeather: 0,
      maskInvert: false,
      maskGrow: 0,
      locked: false,
      hidden: false,
      layout: null,
      grow: 0,
      nodes: [],
      closed: false,
      duration: 0,
      start: 0,
      end: 0,
      keys: {},
      shapeKeys: [],
      clipFrom: 0,
      volume: 1,
      childIds: [],
    };
    next.elements[group.id] = group;
    // the group goes just above the highest picked thing, before anything is taken out
    list.splice(list.indexOf(topBranch) + 1, 0, group.id);
    // keep the stacking order they already had on the page
    const order = paintOrder(doc);
    const ordered = [...ids].sort((p, q) => order.indexOf(p) - order.indexOf(q));
    for (const id of ordered) {
      const el = next.elements[id];
      const from = el.parentId ? next.elements[el.parentId].childIds : next.rootIds;
      const i = from.indexOf(id);
      if (i >= 0) from.splice(i, 1);
      dropIfEmptyGroup(next, el.parentId);
      el.parentId = group.id;
      el.x = pos[id].x - x;
      el.y = pos[id].y - y;
      group.childIds.push(id);
    }
    return next;
  },
};

/** Every id in the order it is painted, bottom first. */
function paintOrder(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      out.push(id);
      walk(doc.elements[id]?.childIds ?? []);
    }
  };
  walk(doc.rootIds);
  return out;
}

/** A group left with nothing in it is removed, and so is a group that only held that one. */
function dropIfEmptyGroup(doc: Doc, id: string | null) {
  const g = id ? doc.elements[id] : undefined;
  if (!g || g.type !== "group" || g.childIds.length > 0) return;
  const list = g.parentId ? doc.elements[g.parentId].childIds : doc.rootIds;
  list.splice(list.indexOf(g.id), 1);
  delete doc.elements[g.id];
  dropIfEmptyGroup(doc, g.parentId);
}

// ---- make_mask ----
export interface MaskArgs {
  /** The shape the other things will show through. */
  maskId: string;
  /** The things to show through it. */
  ids: string[];
  groupId: string;
}

/** Put things in a group with a shape, so they show only inside that shape. */
const makeMask: CommandDef<MaskArgs> = {
  label: () => "Use as mask",
  run: (doc, a) => {
    const ids = a.ids.filter((id) => id !== a.maskId && doc.elements[id]);
    if (!canMask(doc.elements[a.maskId]) || ids.length === 0) return doc;
    const next = groupElements.run(doc, { ids: [a.maskId, ...ids], groupId: a.groupId });
    if (next === doc) return doc;
    const g = next.elements[a.groupId];
    // the shape goes to the bottom of the group: that is what marks it as the mask
    g.childIds = [a.maskId, ...g.childIds.filter((c) => c !== a.maskId)];
    g.mask = true;
    // in a scene that plays, the mask lives as long as what it shows, so the timeline bar is still the clip's
    const scene = sceneOf(next, a.groupId);
    if (scene) {
      const spans = ids.map((id) => spanOf(next.elements[id], scene));
      const start = Math.min(...spans.map((s) => s.start));
      const end = Math.max(...spans.map((s) => s.end));
      g.start = start;
      g.end = end < scene.duration - 0.001 ? end : 0;
    }
    g.name = `Mask ${Object.values(doc.elements).filter((e) => e.type === "group" && e.mask).length + 1}`;
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

// ---- set_duration ----
export interface SetDurationArgs {
  id: string;
  /** How long the frame plays, in seconds. 0 makes it a still design again. */
  seconds: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

const setDuration: CommandDef<SetDurationArgs> = {
  label: (a) => (a.seconds > 0 ? `Make it play for ${round(a.seconds)} seconds` : "Make it a still design"),
  run: (doc, a) => {
    const el = doc.elements[a.id];
    // only a frame on the page plays: the things in it are what is seen over time
    if (!el || el.type !== "frame" || el.parentId) return doc;
    const seconds = Math.max(0, Math.min(3600, round(Number(a.seconds) || 0)));
    if (seconds === el.duration) return doc;
    const next = clone(doc);
    next.elements[a.id].duration = seconds;
    return next;
  },
};

// ---- set_timing ----
export interface SetTimingArgs {
  ids: string[];
  /** The second it appears. */
  start?: number;
  /** The second it leaves. 0 means it stays to the end. */
  end?: number;
  /** A video clip only: the second in its file where playing starts. */
  clipFrom?: number;
}

const setTiming: CommandDef<SetTimingArgs> = {
  label: () => "Change when it shows",
  run: (doc, a) => {
    const next = clone(doc);
    let changed = false;
    for (const id of a.ids) {
      const el = next.elements[id];
      const scene = sceneOf(next, id);
      if (!el || !scene || scene.id === id) continue;
      const was = el.start;
      if (a.start !== undefined) el.start = Math.max(0, Math.min(scene.duration, round(Number(a.start) || 0)));
      if (a.end !== undefined) el.end = Math.max(0, Math.min(scene.duration, round(Number(a.end) || 0)));
      if (el.end && el.end <= el.start) el.end = Math.min(scene.duration, round(el.start + 0.1));
      if (a.clipFrom !== undefined && playsFile(el)) el.clipFrom = Math.max(0, round(Number(a.clipFrom) || 0));
      // what it does over time moves along with it
      const by = el.start - was;
      if (by) for (const prop of MOVING) if (el.keys[prop]) el.keys[prop] = el.keys[prop]!.map((k) => ({ ...k, t: round(k.t + by) }));
      if (by) el.shapeKeys = el.shapeKeys.map((k) => ({ ...k, t: round(k.t + by) }));
      changed = true;
    }
    return changed ? next : doc;
  },
};

// ---- set_key ----
export interface SetKeyArgs {
  ids: string[];
  prop: Moving;
  /** Seconds from the start of the frame it plays in. */
  t: number;
  v: number;
  ease?: Key["ease"];
}

const propName: Record<Moving, string> = { x: "position", y: "position", width: "size", height: "size", opacity: "opacity", rotation: "rotation" };

const setKey: CommandDef<SetKeyArgs> = {
  label: (a) => `Set ${propName[a.prop] ?? "a value"} at ${round(a.t)}s`,
  run: (doc, a) => {
    if (!MOVING.includes(a.prop) || !Number.isFinite(a.t) || !Number.isFinite(a.v)) return doc;
    const next = clone(doc);
    let changed = false;
    for (const id of a.ids) {
      const el = next.elements[id];
      const scene = sceneOf(next, id);
      if (!el || !scene || scene.id === id) continue;
      el.keys[a.prop] = withKey(el.keys[a.prop] ?? [], { t: Math.max(0, Math.min(scene.duration, round(a.t))), v: a.v, ease: a.ease ?? "in-out" });
      changed = true;
    }
    return changed ? next : doc;
  },
};

// ---- set_keys ----
export interface SetKeysArgs {
  id: string;
  prop: Moving;
  /** Every moment of this property, replacing what was there. An empty list makes it stay as it is. */
  keys: { t: number; v: number; ease?: Key["ease"] }[];
}

const setKeys: CommandDef<SetKeysArgs> = {
  label: (a) => (a.keys.length ? `Change ${propName[a.prop] ?? "a value"} over time` : "Remove a change over time"),
  run: (doc, a) => {
    const scene = sceneOf(doc, a.id);
    if (!MOVING.includes(a.prop) || !doc.elements[a.id] || !scene || scene.id === a.id) return doc;
    const next = clone(doc);
    let keys: Key[] = [];
    for (const k of a.keys) if (Number.isFinite(k.t) && Number.isFinite(k.v)) keys = withKey(keys, { t: Math.max(0, Math.min(scene.duration, round(k.t))), v: k.v, ease: k.ease ?? "in-out" });
    if (keys.length) next.elements[a.id].keys[a.prop] = keys;
    else delete next.elements[a.id].keys[a.prop];
    return next;
  },
};

// ---- set_curve ----
export interface SetCurveArgs {
  ids: string[];
  props: Moving[];
  /** The moment the move arrives at: the speed of the move that ends here is what changes. */
  t: number;
  /** A ready shape, or the two handles. */
  shape: CurveName | [number, number, number, number];
}

const setCurve: CommandDef<SetCurveArgs> = {
  label: () => "Change how a move speeds up and slows down",
  run: (doc, a) => {
    const curve = typeof a.shape === "string" ? (CURVES[a.shape] ? ([...CURVES[a.shape]] as [number, number, number, number]) : null) : a.shape;
    if (!curve || curve.length !== 4 || curve.some((n) => !Number.isFinite(n))) return doc;
    // the first handle of each pair must stay inside the time of the move, or time would run backwards
    const shape: [number, number, number, number] = [Math.min(1, Math.max(0, curve[0])), Math.min(4, Math.max(-3, curve[1])), Math.min(1, Math.max(0, curve[2])), Math.min(4, Math.max(-3, curve[3]))];
    const next = clone(doc);
    let changed = false;
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      for (const prop of a.props) {
        const key = el.keys[prop]?.find((k, i) => i > 0 && Math.abs(k.t - a.t) <= 0.004);
        if (!key) continue;
        key.curve = shape;
        changed = true;
      }
    }
    return changed ? next : doc;
  },
};

// ---- key_now ----
export interface KeyNowArgs {
  ids: string[];
  props: Moving[];
  /** Seconds from the start of the frame it plays in. */
  t: number;
}

/** Mark the value things have at one moment, so they can be given another value at another moment. */
const keyNow: CommandDef<KeyNowArgs> = {
  label: (a) => `Mark ${propName[a.props[0]] ?? "a value"} at ${round(a.t)}s`,
  run: (doc, a) => {
    const next = clone(doc);
    let changed = false;
    for (const id of a.ids) {
      const el = next.elements[id];
      const scene = sceneOf(next, id);
      if (!el || !scene || scene.id === id) continue;
      const t = Math.max(0, Math.min(scene.duration, round(a.t)));
      for (const prop of a.props) {
        if (!MOVING.includes(prop)) continue;
        const keys = el.keys[prop] ?? [];
        el.keys[prop] = withKey(keys, { t, v: keys.length ? valueAt(keys, t) : el[prop], ease: "in-out" }, true);
        changed = true;
      }
    }
    return changed ? next : doc;
  },
};

// ---- remove_key ----
export interface RemoveKeyArgs {
  ids: string[];
  /** Leave out to clear every change over time on these things. */
  prop?: Moving;
  /** Several properties at once, instead of prop. */
  props?: Moving[];
  /** Leave out to clear every moment of that property. */
  t?: number;
}

const removeKey: CommandDef<RemoveKeyArgs> = {
  label: () => "Remove a change over time",
  run: (doc, a) => {
    const next = clone(doc);
    for (const id of a.ids) {
      const el = next.elements[id];
      if (!el) continue;
      for (const prop of a.props ?? (a.prop ? [a.prop] : MOVING)) {
        const keys = el.keys[prop];
        if (!keys) continue;
        const left = a.t === undefined ? [] : keys.filter((k) => Math.abs(k.t - a.t!) > 0.004);
        if (left.length) el.keys[prop] = left;
        else delete el.keys[prop];
      }
    }
    return next;
  },
};

// ---- move_key ----
export interface MoveKeyArgs {
  id: string;
  from: number;
  to: number;
  /** Move only these kinds of change. Leave out to move everything marked at that moment. */
  props?: Moving[];
}

const moveKey: CommandDef<MoveKeyArgs> = {
  label: () => "Move a moment",
  run: (doc, a) => {
    if (!Number.isFinite(a.from) || !Number.isFinite(a.to)) return doc;
    const el = doc.elements[a.id];
    const scene = sceneOf(doc, a.id);
    if (!el || !scene) return doc;
    const to = Math.max(0, Math.min(scene.duration, round(a.to)));
    const next = clone(doc);
    let changed = false;
    for (const prop of a.props ?? MOVING) {
      const keys = next.elements[a.id].keys[prop];
      if (!keys) continue;
      const matching = keys.filter((k) => Math.abs(k.t - a.from) <= 0.004);
      if (!matching.length) continue;
      changed = true;
      let left = keys.filter((k) => Math.abs(k.t - a.from) > 0.004);
      for (const k of matching) {
        left = withKey(left, { ...k, t: to });
      }
      next.elements[a.id].keys[prop] = left;
    }
    return changed ? next : doc;
  },
};

// ---- split_at ----
export interface SplitArgs {
  /** The frame that plays. */
  sceneId: string;
  /** The second to cut at. */
  t: number;
  /** The things to cut. Leave out to cut everything that is showing at that second. */
  ids?: string[];
  /** Names for the second halves, by the thing they were cut from. Made up when left out. */
  newIds?: Record<string, string>;
}

/** The things in a frame that are showing at one second, with room on both sides to be cut there. */
export function cuttable(doc: Doc, sceneId: string, t: number, ids?: string[]): string[] {
  const scene = doc.elements[sceneId];
  if (!scene || !(scene.duration > 0)) return [];
  return scene.childIds.filter((id) => {
    const el = doc.elements[id];
    if (!el || el.childIds.length || el.type === "instance" || (ids && !ids.includes(id))) return false;
    const span = spanOf(el, scene);
    return t > span.start + 0.03 && t < span.end - 0.03;
  });
}

const splitAt: CommandDef<SplitArgs> = {
  label: () => "Cut at the playhead",
  run: (doc, a) => {
    const list = cuttable(doc, a.sceneId, a.t, a.ids);
    if (!list.length) return doc;
    const next = clone(doc);
    const scene = next.elements[a.sceneId];
    const t = round(a.t);
    for (const id of list) {
      const first = next.elements[id];
      const span = spanOf(first, scene);
      const second: El = structuredClone(first);
      second.id = a.newIds?.[id] ?? newId(first.type);
      second.start = t;
      // one that stayed to the end still does
      second.end = first.end ? span.end : 0;
      if (playsFile(first)) second.clipFrom = round(fileTimeAt(first, span.start, t));
      first.end = t;
      next.elements[second.id] = second;
      scene.childIds.splice(scene.childIds.indexOf(id) + 1, 0, second.id);
    }
    return next;
  },
};

// ---- ripple_delete ----
export interface RippleDeleteArgs {
  ids: string[];
}

const rippleDelete: CommandDef<RippleDeleteArgs> = {
  label: () => "Delete and close the gap",
  run: (doc, a) => {
    // only things that sit straight in a frame that plays have a place in time to close
    const ids = a.ids.filter((id) => doc.elements[id] && sceneOf(doc, id)?.id === doc.elements[id].parentId);
    if (!ids.length) return doc;
    const scenes = new Map<string, { start: number; end: number }[]>();
    for (const id of ids) {
      const scene = sceneOf(doc, id)!;
      scenes.set(scene.id, (scenes.get(scene.id) ?? []).concat(spanOf(doc.elements[id], scene)));
    }
    const next = deleteElements.run(doc, { ids });
    for (const [sceneId, spans] of scenes) {
      // stretches of time taken out, joined where they touch, so a gap is closed once
      const gaps: { start: number; end: number }[] = [];
      for (const s of spans.sort((x, y) => x.start - y.start)) {
        const last = gaps[gaps.length - 1];
        if (last && s.start <= last.end + 0.004) last.end = Math.max(last.end, s.end);
        else gaps.push({ ...s });
      }
      const frame = next.elements[sceneId];
      for (const c of frame.childIds) {
        const el = next.elements[c];
        const by = round(gaps.filter((g) => g.end <= el.start + 0.004).reduce((sum, g) => sum + (g.end - g.start), 0));
        if (!by) continue;
        el.start = round(el.start - by);
        if (el.end) el.end = round(el.end - by);
        for (const prop of MOVING) if (el.keys[prop]) el.keys[prop] = el.keys[prop]!.map((k) => ({ ...k, t: round(k.t - by) }));
      }
      // the video is shorter by what was taken out
      frame.duration = Math.max(0.1, round(frame.duration - gaps.reduce((sum, g) => sum + (g.end - g.start), 0)));
      for (const c of frame.childIds) {
        const el = next.elements[c];
        if (el.end > frame.duration) el.end = frame.duration;
        if (el.start > frame.duration - 0.05) el.start = Math.max(0, round(frame.duration - 0.1));
      }
    }
    return next;
  },
};

// ---- set_entrance ----
export interface SetEntranceArgs {
  ids: string[];
  /** How it arrives when it appears, or how it goes when it leaves. */
  when: "in" | "out";
  kind: Entrance;
  /** How long that takes, in seconds. */
  seconds?: number;
}

const setEntrance: CommandDef<SetEntranceArgs> = {
  label: (a) => (a.when === "in" ? "Change how it arrives" : "Change how it leaves"),
  run: (doc, a) => {
    if (!ENTRANCES.includes(a.kind)) return doc;
    const next = clone(doc);
    let changed = false;
    for (const id of a.ids) {
      const el = next.elements[id];
      const scene = sceneOf(next, id);
      if (!el || !scene || scene.id === id) continue;
      el.keys = entranceKeys(el, scene, a.when, a.kind, Math.max(0.05, Number(a.seconds) || 0.4));
      changed = true;
    }
    return changed ? next : doc;
  },
};

const createPresetFrameDef: CommandDef<CreatePresetFrameArgs> = {
  label: (a) => `Add ${a.preset.name.toLowerCase()} frame`,
  run: (doc, a) => {
    const x = a.x ?? (a.center ? Math.round(a.center.x - a.preset.width / 2) : 0);
    const y = a.y ?? (a.center ? Math.round(a.center.y - a.preset.height / 2) : 0);
    return createElement.run(doc, {
      type: "frame",
      id: a.id,
      x,
      y,
      width: a.preset.width,
      height: a.preset.height,
      props: { name: a.preset.name },
    });
  },
};

// ---- set_shape_key ----
export interface SetShapeKeyArgs {
  id: string;
  /** Seconds from the start of the frame it plays in. */
  t: number;
  /** The outline at that moment, in pixels inside the parent. Left out: the outline as it is now. */
  points?: ShapeKey["points"];
  ease?: Key["ease"];
}

/**
 * Make a drawn shape's outline be this at one moment. The first key on a shape also keeps the outline it
 * had until now, at the first moment of its time, so there is something to blend from.
 */
const setShapeKey: CommandDef<SetShapeKeyArgs> = {
  label: () => "Change the shape at this moment",
  run: (doc, a) => {
    const el = doc.elements[a.id];
    const scene = sceneOf(doc, a.id);
    if (!el || el.type !== "path" || !scene || scene.id === a.id) return doc;
    const at = Math.max(0, Math.min(scene.duration, round(Number(a.t) || 0)));
    const next = clone(doc);
    const me = next.elements[a.id];
    const now = a.points ?? outlineOf(el);
    if (!me.shapeKeys.length) {
      const first = spanOf(el, scene).start;
      if (Math.abs(first - at) > 0.004) me.shapeKeys = withShapeKey(me.shapeKeys, { t: first, points: outlineOf(el), ease: "in-out" });
    }
    me.shapeKeys = withShapeKey(me.shapeKeys, { t: at, points: now, ease: a.ease ?? "in-out" });
    return next;
  },
};

// ---- remove_shape_key ----
export interface RemoveShapeKeyArgs {
  id: string;
  t: number;
}

/** Take away the outline kept at one moment. With none left, the shape stays as it was last drawn. */
const removeShapeKey: CommandDef<RemoveShapeKeyArgs> = {
  label: () => "Remove a shape key",
  run: (doc, a) => {
    const el = doc.elements[a.id];
    if (!el || !el.shapeKeys.some((k) => Math.abs(k.t - a.t) <= 0.004)) return doc;
    const next = clone(doc);
    const me = next.elements[a.id];
    me.shapeKeys = me.shapeKeys.filter((k) => Math.abs(k.t - a.t) > 0.004);
    return next;
  },
};

// ---- registry ----
export const commands = {
  create_element: createElement,
  create_elements: createElements,
  create_preset_frame: createPresetFrameDef,
  move_elements: moveElements,
  resize_element: resizeElement,
  set_props: setProps,
  set_grade: setGrade,
  set_background: setBackground,
  delete_elements: deleteElements,
  reparent_elements: reparentElements,
  arrange_elements: arrangeElements,
  paste_elements: pasteElements,
  set_layout: setLayout,
  wrap_in_layout: wrapInLayout,
  group_elements: groupElements,
  make_mask: makeMask,
  ungroup,
  create_text_style: createTextStyle,
  apply_text_style: applyTextStyle,
  update_text_style: updateTextStyle,
  delete_text_style: deleteTextStyle,
  create_component: createComponent,
  create_instance: createInstance,
  detach_instance: detachCommand,
  reset_overrides: resetOverrides,
  set_duration: setDuration,
  set_timing: setTiming,
  set_shape_key: setShapeKey,
  remove_shape_key: removeShapeKey,
  set_key: setKey,
  set_keys: setKeys,
  key_now: keyNow,
  set_curve: setCurve,
  remove_key: removeKey,
  move_key: moveKey,
  set_entrance: setEntrance,
  split_at: splitAt,
  ripple_delete: rippleDelete,
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

export { FRAME_PRESETS, createPresetFrame } from "./presets";
export type { FramePreset, CreatePresetFrameArgs } from "./presets";

