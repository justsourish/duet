import { message } from "@tauri-apps/plugin-dialog";
import { clipKind, dropClips, keepDropped } from "../video/scene";
import { setLayout } from "../ui/layout";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { newId, runCommand } from "../commands";
import { extractPayload, payloadToText, textToPayload } from "../document/clipboard";
import type { ClipPayload } from "../document/clipboard";
import {
  canTurn,
  descendants,
  frameAt,
  hitTest,
  rectsIntersect,
  snapRect,
  tidyAngle,
  topLevelOnly,
  turnCentre,
  turnOf,
  turnPoint,
  unionRect,
  worldBounds,
  worldPos,
  worldRect,
} from "../document/geometry";
import { canBeComponent } from "../document/components";
import type { Doc, ElementType, Rect } from "../document/types";
import {
  clearOverlay,
  workDoc,
  dispatch,
  dragBase,
  dragCancel,
  dragCommit,
  dragPreview,
  dragPreviewDoc,
  getState,
  nudge,
  redo,
  select,
  setEditing,
  setOverlay,
  setTool,
  setViewport,
  subscribe,
  undo,
  useStore,
} from "../state/store";
import type { Tool } from "../state/store";
import { HANDLES, TURN_CURSOR, TURN_REACH, handleCursor, resizeTurned } from "./handles";
import type { HandleKey } from "./handles";
import { pickImages, placeFiles } from "../project/imageImport";
import { deleteSelectedNode, doubleClickNode, dragNode, editing, enterNodeEdit, exitNodeEdit, hitNode, nodesOf, selectNode } from "./nodes";
import type { NodeHit } from "./nodes";
import type { AbsNode } from "../document/path";
import { logError } from "../errorLog";
import { defaultLayout } from "../document/layout";
import { penActive, penBack, penCancel, penDown, penDrag, penFinish, penHover } from "./pen";
import { draw, labelRect, screenRect } from "./render";
import { fontCss, layoutText, lineStep, textLift } from "./text";

type Drag =
  | { kind: "pen"; index: number | null }
  | { kind: "node"; hit: NodeHit; start: AbsNode[]; at: { x: number; y: number }; sx: number; sy: number; moved: boolean }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "create"; type: ElementType; start: { x: number; y: number }; parentId: string | null; sx: number; sy: number }
  | { kind: "move"; start: { x: number; y: number }; ids: string[]; base: Doc; moved: boolean; sx: number; sy: number; duplicate?: boolean }
  | { kind: "resize"; handle: HandleKey; id: string; orig: Rect; turn: number; sx: number; sy: number; start: { x: number; y: number } }
  | { kind: "turn"; id: string; centre: { x: number; y: number }; from: number; base: number; sx: number; sy: number; moved: boolean }
  | { kind: "zoom"; sx: number; sy: number; startZoom: number; vx: number; vy: number; moved: boolean; priorGlide: { zoom: number; zoomIn?: boolean } | null }
  | { kind: "marquee"; start: { x: number; y: number }; prev: string[]; additive: boolean; scope: string[] };

/** Where files dragged in from the computer are, when the system says so. */
function droppedPaths(data: DataTransfer): string[] {
  const out: string[] = [];
  for (const kind of ["text/uri-list", "public.file-url", "text/plain"]) {
    for (const line of data.getData(kind).split(/\r?\n/)) {
      if (!line.startsWith("file://")) continue;
      try {
        const path = decodeURIComponent(new URL(line.trim()).pathname);
        if (!out.includes(path)) out.push(path);
      } catch {
        // not a place on the computer
      }
    }
  }
  return out;
}

const CREATE_TOOLS: Tool[] = ["frame", "rect", "ellipse", "text"];
const DEFAULT_SIZE: Record<ElementType, { w: number; h: number }> = {
  frame: { w: 360, h: 640 },
  rect: { w: 120, h: 120 },
  ellipse: { w: 120, h: 120 },
  text: { w: 40, h: 21 },
  image: { w: 240, h: 160 },
  path: { w: 100, h: 100 },
  group: { w: 100, h: 100 },
  instance: { w: 100, h: 100 },
  video: { w: 320, h: 180 },
  sound: { w: 1, h: 1 },
};

/** Copy of what was last copied inside this window, in case the system clipboard is unavailable. */
let inMemoryClip: ClipPayload | null = null;

/** Paste a payload where it makes sense: inside a selected frame, otherwise next to the original. */
export function pastePayload(payload: ClipPayload, duplicate = false) {
  const s = getState();
  const doc = workDoc(s);
  const sel = s.selection.filter((i) => doc.elements[i]);
  let parentId: string | null = null;
  if (sel.length === 1) {
    const one = doc.elements[sel[0]];
    parentId = one.type === "frame" && !duplicate ? one.id : one.parentId;
  } else if (sel.length > 1) parentId = doc.elements[sel[0]].parentId;
  const idMap: Record<string, string> = {};
  for (const [oldId, el] of Object.entries(payload.elements)) idMap[oldId] = newId(el.type);
  const first = payload.elements[payload.rootIds[0]];
  const pageFrame = !first.parentId && first.type === "frame";
  // Pasting on top of the original would hide it. Nudge, or put a copied screen beside its original.
  const sameSpot = payload.rootIds.every((id) => doc.elements[id]?.parentId === parentId);
  const dx = pageFrame && sameSpot ? first.width + 40 : sameSpot || duplicate ? 16 : 0;
  const dy = pageFrame && sameSpot ? 0 : sameSpot || duplicate ? 16 : 0;
  dispatch("paste_elements", { payload, parentId, dx, dy, idMap, label: duplicate ? "Duplicate" : "Paste" });
  select(payload.rootIds.map((id) => idMap[id]));
}

/** Check whether an element can be picked up and moved. */
export function isMovable(doc: Doc, id: string | null): boolean {
  if (!id) return false;
  const el = doc.elements[id];
  if (!el || el.locked) return false;
  let p = el.parentId;
  while (p) {
    if (doc.elements[p]?.locked) return false;
    p = doc.elements[p]?.parentId;
  }
  return true;
}

/** Duplicate elements in place so their copies can be dragged while leaving originals behind. */
export function prepareDuplicate(doc: Doc, ids: string[]): { base: Doc; copyIds: string[] } | null {
  const payload = extractPayload(doc, ids);
  if (!payload || payload.rootIds.length === 0) return null;
  const idMap: Record<string, string> = {};
  for (const [oldId, el] of Object.entries(payload.elements)) idMap[oldId] = newId(el.type);
  const copyIds = payload.rootIds.map((id) => idMap[id]);
  const parentId = doc.elements[ids[0]]?.parentId ?? null;
  const base = runCommand(doc, "paste_elements", {
    payload,
    parentId,
    dx: 0,
    dy: 0,
    idMap,
    label: "Duplicate",
  });
  return { base, copyIds };
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

const ZOOM_LEVELS = [0.02, 0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];

export function nextZoomLevel(current: number, zoomIn: boolean): number {
  if (zoomIn) {
    for (const z of ZOOM_LEVELS) {
      if (z > current * 1.01) return z;
    }
    return MAX_ZOOM;
  }
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < current * 0.99) return ZOOM_LEVELS[i];
  }
  return MIN_ZOOM;
}

const GLIDE_MS = 200;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const animFrame = (cb: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return setTimeout(() => cb(Date.now()), 16) as unknown as number;
};

const cancelAnimFrame = (id: number) => {
  if (typeof cancelAnimationFrame === "function") return cancelAnimationFrame(id);
  clearTimeout(id);
};

let glideRaf = 0;
let activeGlideTarget: { x: number; y: number; zoom: number; zoomIn?: boolean } | null = null;

export function stopGlide() {
  if (glideRaf) {
    cancelAnimFrame(glideRaf);
    glideRaf = 0;
  }
  activeGlideTarget = null;
}

/** Glide the viewport to a new place and zoom level. */
export function glideTo(target: { x: number; y: number; zoom: number; zoomIn?: boolean }) {
  stopGlide();
  const start = getState().viewport;
  if (start.x === target.x && start.y === target.y && start.zoom === target.zoom) return;
  activeGlideTarget = target;
  const nowFn = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const startTime = nowFn();

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / GLIDE_MS);
    const t = easeOut(progress);

    if (progress >= 1) {
      glideRaf = 0;
      activeGlideTarget = null;
      setViewport({ x: target.x, y: target.y, zoom: target.zoom });
      return;
    }

    setViewport({
      zoom: start.zoom + (target.zoom - start.zoom) * t,
      x: start.x + (target.x - start.x) * t,
      y: start.y + (target.y - start.y) * t,
    });

    glideRaf = animFrame(tick);
  };

  glideRaf = animFrame(tick);
}

function fitBox(box: Rect, width: number, height: number, maxZoom: number, pad = 120) {
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, (width - pad * 2) / box.width, (height - pad * 2) / box.height));
  glideTo({
    zoom,
    x: width / 2 - (box.x + box.width / 2) * zoom,
    y: height / 2 - (box.y + box.height / 2) * zoom,
  });
}

/** Show everything on the page. */
export function zoomToFit(width: number, height: number) {
  const doc = workDoc();
  const box = unionRect(doc.rootIds.map((id) => worldBounds(doc, id)));
  if (!box) return glideTo({ x: 160, y: 100, zoom: 1 });
  fitBox(box, width, height, 2);
}

/** Jump to whatever is selected, or to the given elements. */
export function zoomToElements(ids: string[], width: number, height: number) {
  const doc = workDoc();
  const box = unionRect(ids.filter((i) => doc.elements[i]).map((id) => worldBounds(doc, id)));
  if (!box) return;
  fitBox(box, width, height, 4);
}

/** Bring things into view only if they are off screen, keeping the zoom when they fit. */
export function revealElements(ids: string[], width: number, height: number) {
  const doc = workDoc();
  const box = unionRect(ids.filter((i) => doc.elements[i]).map((id) => worldBounds(doc, id)));
  if (!box) return;
  const vp = getState().viewport;
  const left = box.x * vp.zoom + vp.x;
  const top = box.y * vp.zoom + vp.y;
  const right = left + box.width * vp.zoom;
  const bottom = top + box.height * vp.zoom;
  const visible = left >= 0 && top >= 0 && right <= width && bottom <= height;
  if (visible) return;
  if (box.width * vp.zoom <= width * 0.9 && box.height * vp.zoom <= height * 0.9) {
    glideTo({ zoom: vp.zoom, x: width / 2 - (box.x + box.width / 2) * vp.zoom, y: height / 2 - (box.y + box.height / 2) * vp.zoom });
  } else {
    fitBox(box, width, height, 4);
  }
}

/** Set the zoom level, keeping the middle of the screen where it is. */
export function zoomTo(level: number, width: number, height: number) {
  const vp = getState().viewport;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
  const wx = (width / 2 - vp.x) / vp.zoom;
  const wy = (height / 2 - vp.y) / vp.zoom;
  glideTo({ zoom, x: width / 2 - wx * zoom, y: height / 2 - wy * zoom });
}

export default function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const rafRef = useRef(0);
  const editingId = useStore((s) => s.editingId);
  const viewport = useStore((s) => s.viewport);

  // Choosing something else ends point editing.
  const selNow = useStore((st) => st.selection);
  useEffect(() => {
    const ne = editing();
    if (ne && !(selNow.length === 1 && selNow[0] === ne.id)) exitNodeEdit();
  }, [selNow]);

  // Switching to another tool ends the line you were drawing.
  const toolNow = useStore((st) => st.tool);
  useEffect(() => {
    if (toolNow !== "pen" && penActive()) penFinish(false, false);
  }, [toolNow]);

  // ---------- drawing ----------
  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const { w, h, dpr } = sizeRef.current;
      try {
        draw(ctx, getState(), w, h, dpr);
      } catch (e) {
        // A drawing error must never leave the canvas stuck. Starting the canvas afresh clears any
        // half-finished clipping, and the error is kept so it can be found.
        c.width = c.width;
        logError("canvas draw", e);
      }
    });
  };

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h, dpr };
      schedule();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const unsub = subscribe(schedule);
    window.addEventListener("duet:repaint", schedule);
    return () => {
      ro.disconnect();
      unsub();
      window.removeEventListener("duet:repaint", schedule);
      stopGlide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- helpers ----------
  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const vp = getState().viewport;
    return { sx, sy, x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
  };

  const zoomAt = (sx: number, sy: number, factor: number) => {
    const vp = getState().viewport;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor));
    const wx = (sx - vp.x) / vp.zoom;
    const wy = (sy - vp.y) / vp.zoom;
    setViewport({ zoom, x: sx - wx * zoom, y: sy - wy * zoom });
  };

  const handleAt = (sx: number, sy: number): HandleKey | null => {
    const s = getState();
    const doc = workDoc(s);
    if (editing() || s.selection.length !== 1 || !doc.elements[s.selection[0]]) return null;
    const r = screenRect(s, worldRect(doc, s.selection[0]));
    // the handles of a turned shape are turned with it, so turn the pointer back to meet them
    const p = turnPoint(sx, sy, r.x + r.width / 2, r.y + r.height / 2, -turnOf(doc.elements[s.selection[0]]));
    for (const hd of HANDLES) {
      const hx = r.x + r.width * hd.fx;
      const hy = r.y + r.height * hd.fy;
      if (Math.abs(p.x - hx) <= 6 && Math.abs(p.y - hy) <= 6) return hd.key;
    }
    return null;
  };

  /** Just outside a corner of the selected thing, dragging turns it. */
  const turnAt = (sx: number, sy: number): string | null => {
    const s = getState();
    const doc = workDoc(s);
    const id = s.selection[0];
    if (editing() || s.selection.length !== 1 || !doc.elements[id] || !canTurn(doc, id)) return null;
    const r = screenRect(s, worldRect(doc, id));
    const p = turnPoint(sx, sy, r.x + r.width / 2, r.y + r.height / 2, -turnOf(doc.elements[id]));
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return null;
    for (const [cx, cy] of [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]]) {
      if (Math.hypot(p.x - cx, p.y - cy) <= TURN_REACH) return id;
    }
    return null;
  };

  const labelAt = (sx: number, sy: number): string | null => {
    const s = getState();
    const doc = workDoc(s);
    for (let i = doc.rootIds.length - 1; i >= 0; i--) {
      const id = doc.rootIds[i];
      if (doc.elements[id]?.type !== "frame" && doc.elements[id]?.type !== "instance") continue;
      const r = labelRect(s, doc, id);
      if (sx >= r.x && sx <= r.x + r.width && sy >= r.y && sy <= r.y + r.height) return id;
    }
    return null;
  };

  const setCursor = (c: string) => {
    if (canvasRef.current) canvasRef.current.style.cursor = c;
  };

  // ---------- pointer ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (getState().editingId) return;
    const p = point(e);
    const s = getState();
    canvasRef.current!.setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceRef.current || s.tool === "hand") {
      stopGlide();
      dragRef.current = { kind: "pan", sx: p.sx, sy: p.sy, vx: s.viewport.x, vy: s.viewport.y };
      setCursor("grabbing");
      return;
    }

    if (s.tool === "pen") {
      stopGlide();
      dragRef.current = { kind: "pen", index: penDown(p, s.viewport.zoom) };
      return;
    }

    if (s.tool === "zoom") {
      const priorGlide = activeGlideTarget;
      stopGlide();
      dragRef.current = {
        kind: "zoom",
        sx: p.sx,
        sy: p.sy,
        startZoom: s.viewport.zoom,
        vx: s.viewport.x,
        vy: s.viewport.y,
        moved: false,
        priorGlide,
      };
      return;
    }

    stopGlide();

    if (CREATE_TOOLS.includes(s.tool)) {
      const type = s.tool as ElementType;
      const parentId = frameAt(workDoc(s), p.x, p.y);
      dragRef.current = { kind: "create", type, start: { x: p.x, y: p.y }, parentId, sx: p.sx, sy: p.sy };
      return;
    }

    // move tool
    const doc = workDoc(s);
    const ne = editing();
    if (ne) {
      const nh = hitNode(p.sx, p.sy);
      if (nh) {
        selectNode(nh.index);
        dragRef.current = { kind: "node", hit: nh, start: nodesOf(doc, ne.id), at: { x: p.x, y: p.y }, sx: p.sx, sy: p.sy, moved: false };
        return;
      }
      if (hitTest(doc, p.x, p.y) === ne.id) {
        selectNode(null);
        return;
      }
      exitNodeEdit();
    }
    const handle = handleAt(p.sx, p.sy);
    if (handle) {
      const id = s.selection[0];
      dragRef.current = { kind: "resize", handle, id, orig: worldRect(doc, id), turn: turnOf(doc.elements[id]), sx: p.sx, sy: p.sy, start: { x: p.x, y: p.y } };
      return;
    }
    const turning = turnAt(p.sx, p.sy);
    if (turning) {
      const centre = turnCentre(doc, turning);
      const from = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
      dragRef.current = { kind: "turn", id: turning, centre, from, base: doc.elements[turning].rotation || 0, sx: p.sx, sy: p.sy, moved: false };
      return;
    }

    // Cmd or Ctrl click digs into groups
    const hit = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y, new Set(), e.metaKey || e.ctrlKey);
    if (hit) {
      if (!isMovable(doc, hit)) return;
      if (e.shiftKey) {
        const has = s.selection.includes(hit);
        select(has ? s.selection.filter((i) => i !== hit) : [...s.selection, hit]);
        if (has) return;
      } else if (!s.selection.includes(hit)) {
        select([hit]);
      }
      const ids = topLevelOnly(doc, getState().selection);
      if (e.altKey) {
        const dup = prepareDuplicate(dragBase(), ids);
        if (dup) {
          dragRef.current = { kind: "move", start: { x: p.x, y: p.y }, ids: dup.copyIds, base: dup.base, moved: false, sx: p.sx, sy: p.sy, duplicate: true };
          return;
        }
      }
      dragRef.current = { kind: "move", start: { x: p.x, y: p.y }, ids, base: dragBase(), moved: false, sx: p.sx, sy: p.sy };
      return;
    }

    if (!e.shiftKey) select([]);
    // A marquee that starts inside a frame picks that frame's contents, not the frame itself.
    const home = frameAt(doc, p.x, p.y);
    const scope = home ? doc.elements[home].childIds : doc.rootIds;
    dragRef.current = { kind: "marquee", start: { x: p.x, y: p.y }, prev: e.shiftKey ? s.selection : [], additive: e.shiftKey, scope };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = point(e);
    const d = dragRef.current;
    const s = getState();

    if (!d) {
      if (s.editingId) return;
      if (spaceRef.current || s.tool === "hand") return setCursor("grab");
      if (s.tool === "pen") {
        penHover(p);
        return setCursor("crosshair");
      }
      if (CREATE_TOOLS.includes(s.tool)) return setCursor(s.tool === "text" ? "text" : "crosshair");
      if (s.tool === "zoom") return setCursor(e.altKey ? "zoom-out" : "zoom-in");
      const h = handleAt(p.sx, p.sy);
      if (h) {
        if (s.overlay.hoverId) setOverlay({ hoverId: null });
        return setCursor(handleCursor(h, turnOf(workDoc(s).elements[s.selection[0]])));
      }
      if (turnAt(p.sx, p.sy)) {
        if (s.overlay.hoverId) setOverlay({ hoverId: null });
        return setCursor(TURN_CURSOR);
      }
      const doc = workDoc(s);
      const hover = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y);
      if (hover !== s.overlay.hoverId) setOverlay({ hoverId: hover });
      if (e.altKey && isMovable(doc, hover)) return setCursor("copy");
      setCursor("default");
      return;
    }

    if (d.kind === "node") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      dragNode(d.hit, d.start, p.x - d.at.x, p.y - d.at.y, e.altKey);
      return;
    }

    if (d.kind === "pen") {
      if (d.index !== null) penDrag(d.index, p, s.viewport.zoom);
      return;
    }

    if (d.kind === "pan") {
      setViewport({ ...s.viewport, x: d.vx + (p.sx - d.sx), y: d.vy + (p.sy - d.sy) });
      return;
    }

    if (d.kind === "zoom") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      const factor = Math.exp((p.sx - d.sx) * 0.006);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, d.startZoom * factor));
      const wx = (d.sx - d.vx) / d.startZoom;
      const wy = (d.sy - d.vy) / d.startZoom;
      setViewport({ zoom, x: d.sx - wx * zoom, y: d.sy - wy * zoom });
      return;
    }

    if (d.kind === "create") {
      const rect = normalize(d.start.x, d.start.y, p.x, p.y);
      setOverlay({ draft: { type: d.type, rect } });
      return;
    }

    if (d.kind === "move") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      if (!d.moved) {
        d.moved = true;
        if (d.duplicate) select(d.ids);
      }
      if (d.duplicate) setCursor("copy");
      let dx = p.x - d.start.x;
      let dy = p.y - d.start.y;
      let guidesX: number[] = [];
      let guidesY: number[] = [];
      if (!(e.metaKey || e.ctrlKey)) {
        const skip = new Set<string>();
        for (const id of d.ids) {
          skip.add(id);
          descendants(d.base, id).forEach((x) => skip.add(x));
        }
        const others = Object.keys(d.base.elements)
          .filter((id) => !skip.has(id))
          .map((id) => worldBounds(d.base, id));
        const box = unionRect(d.ids.map((id) => worldBounds(d.base, id)));
        if (box) {
          const snap = snapRect({ ...box, x: box.x + dx, y: box.y + dy }, others, 6 / s.viewport.zoom);
          dx += snap.dx;
          dy += snap.dy;
          guidesX = snap.guidesX;
          guidesY = snap.guidesY;
        }
      }
      if (d.duplicate) {
        dragPreviewDoc(runCommand(d.base, "move_elements", { ids: d.ids, dx, dy }));
      } else {
        dragPreview("move_elements", { ids: d.ids, dx, dy });
      }
      setOverlay({ guidesX, guidesY });
      return;
    }

    if (d.kind === "resize") {
      const rect = resizeTurned(d.orig, d.turn, d.handle, p.x - d.start.x, p.y - d.start.y, { keepRatio: e.shiftKey, fromCenter: e.altKey });
      const doc = dragBase();
      const el = doc.elements[d.id];
      const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
      dragPreview("resize_element", { id: d.id, x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height });
      return;
    }

    if (d.kind === "turn") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      const now = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) * 180) / Math.PI;
      // whole degrees, or steps of 15 with Shift
      const step = e.shiftKey ? 15 : 1;
      const rotation = tidyAngle(Math.round((d.base + now - d.from) / step) * step);
      dragPreview("set_props", { ids: [d.id], props: { rotation } });
      setOverlay({ turning: rotation });
      return;
    }

    if (d.kind === "marquee") {
      const rect = normalize(d.start.x, d.start.y, p.x, p.y);
      const doc = workDoc(s);
      const inside = d.scope.filter((id) => doc.elements[id] && !doc.elements[id].locked && rectsIntersect(rect, worldBounds(doc, id)));
      setOverlay({ marquee: rect });
      select(d.additive ? Array.from(new Set([...d.prev, ...inside])) : inside);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    const p = point(e);

    if (d.kind === "node") {
      if (d.moved) dragCommit("Edit points");
      else dragCancel();
      return;
    }

    if (d.kind === "pen") return;

    if (d.kind === "pan") {
      setCursor(spaceRef.current ? "grab" : "default");
      return;
    }

    if (d.kind === "zoom") {
      if (!d.moved) {
        const zoomIn = !e.altKey;
        const vp = getState().viewport;
        const baseZoom = d.priorGlide && d.priorGlide.zoomIn === zoomIn ? d.priorGlide.zoom : vp.zoom;
        const targetZoom = nextZoomLevel(baseZoom, zoomIn);
        const wx = (d.sx - vp.x) / vp.zoom;
        const wy = (d.sy - vp.y) / vp.zoom;
        glideTo({
          zoom: targetZoom,
          x: d.sx - wx * targetZoom,
          y: d.sy - wy * targetZoom,
          zoomIn,
        });
      }
      return;
    }

    if (d.kind === "create") {
      const dragged = Math.hypot(p.sx - d.sx, p.sy - d.sy) >= 4;
      const size = DEFAULT_SIZE[d.type];
      const world = dragged
        ? normalize(d.start.x, d.start.y, p.x, p.y)
        : { x: d.start.x, y: d.start.y, width: size.w, height: size.h };
      const doc = workDoc();
      const parent = d.parentId ? worldPos(doc, d.parentId) : { x: 0, y: 0 };
      const id = newId(d.type);
      dispatch("create_element", {
        id,
        type: d.type,
        x: world.x - parent.x,
        y: world.y - parent.y,
        width: world.width,
        height: world.height,
        parentId: d.parentId,
      });
      select([id]);
      setTool("move");
      clearOverlay();
      if (d.type === "text") setEditing(id);
      return;
    }

    if (d.kind === "move") {
      if (d.moved) {
        let label = d.duplicate ? "Duplicate" : d.ids.length > 1 ? `Move ${d.ids.length} elements` : "Move element";
        const doc = d.base;
        // Dropped over a different frame (or off every frame)? Change parent, like Figma.
        if (d.ids.every((id) => doc.elements[id]?.type !== "frame")) {
          const target = frameAt(doc, p.x, p.y);
          const changing = d.ids.filter((id) => (doc.elements[id].parentId ?? null) !== target);
          if (changing.length > 0) {
            const name = target ? doc.elements[target].name : null;
            if (!d.duplicate) label = name ? `Move into ${name}` : "Move out of frame";
            dragPreviewDoc(runCommand(workDoc(), "reparent_elements", { ids: changing, parentId: target, label: d.duplicate ? "Duplicate" : label }));
          }
        }
        dragCommit(label);
      } else dragCancel();
      setOverlay({ guidesX: [], guidesY: [] });
      if (e.altKey) {
        setCursor(isMovable(workDoc(), labelAt(p.sx, p.sy) ?? hitTest(workDoc(), p.x, p.y)) ? "copy" : "default");
      } else {
        setCursor("default");
      }
      return;
    }

    if (d.kind === "resize") {
      dragCommit("Resize element");
      return;
    }

    if (d.kind === "turn") {
      if (d.moved) dragCommit("Rotate");
      else dragCancel();
      setOverlay({ turning: null });
      return;
    }

    if (d.kind === "marquee") setOverlay({ marquee: null });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (getState().tool === "zoom") return; // each click already zoomed
    if (getState().tool === "pen") {
      if (penActive()) penFinish(false);
      return;
    }
    const p = point(e);
    const doc = workDoc();
    if (editing()) {
      if (doubleClickNode(p.x, p.y, hitNode(p.sx, p.sy))) return;
    }
    const hit = hitTest(doc, p.x, p.y);
    if (hit && doc.elements[hit].type === "path") {
      enterNodeEdit(hit);
      return;
    }
    // double-click a group or a copy of a component to pick what is under the pointer inside it
    if (hit && (doc.elements[hit].type === "group" || doc.elements[hit].type === "instance")) {
      const inner = hitTest(doc, p.x, p.y, new Set(), true);
      if (inner && inner !== hit) select([inner]);
      return;
    }
    // double-click a frame to pick everything inside it
    if (hit && doc.elements[hit].type === "frame" && doc.elements[hit].childIds.length) {
      select(doc.elements[hit].childIds.filter((c) => !doc.elements[c].locked));
      return;
    }
    if (hit && doc.elements[hit].type === "text") {
      select([hit]);
      setEditing(hit);
    }
  };

  // ---------- wheel, pinch ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    // A pinch on a Mac trackpad arrives as gesture events. While one is running, ignore wheel zoom,
    // so the same pinch is never counted twice.
    let pinch: { zoom: number; wx: number; wy: number } | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (getState().editingId) return;
      stopGlide();
      const p = point(e);
      if (e.ctrlKey || e.metaKey) {
        if (pinch) return;
        const step = Math.max(-40, Math.min(40, e.deltaY));
        zoomAt(p.sx, p.sy, Math.exp(-step * 0.01));
      } else {
        const vp = getState().viewport;
        setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY });
      }
    };
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      stopGlide();
      const vp = getState().viewport;
      const p = point(e as GestureEvent);
      // remember which point of the design sits under the fingers, and keep it there
      pinch = { zoom: vp.zoom, wx: (p.sx - vp.x) / vp.zoom, wy: (p.sy - vp.y) / vp.zoom };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!pinch) return;
      const g = e as GestureEvent;
      const p = point(g);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.zoom * g.scale));
      setViewport({ zoom, x: p.sx - pinch.wx * zoom, y: p.sy - pinch.wy * zoom });
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      pinch = null;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart);
    canvas.addEventListener("gesturechange", onGestureChange);
    canvas.addEventListener("gestureend", onGestureEnd);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
      canvas.removeEventListener("gestureend", onGestureEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- copy, cut, paste ----------
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (typing(e.target)) return;
      const s = getState();
      const payload = extractPayload(workDoc(s), s.selection);
      if (!payload) return;
      e.preventDefault();
      inMemoryClip = payload;
      e.clipboardData?.setData("text/plain", payloadToText(payload));
      if (cut) {
        dispatch("delete_elements", { ids: payload.rootIds });
        select([]);
      }
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void placeFiles(files);
        return;
      }
      const fromSystem = textToPayload(e.clipboardData?.getData("text/plain") ?? "");
      const payload = fromSystem ?? inMemoryClip;
      if (!payload) return;
      e.preventDefault();
      pastePayload(payload);
    };
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", paste);
    };
  }, []);

  // ---------- keyboard ----------
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const s = getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === "Alt" && s.tool === "zoom") setCursor("zoom-out");
      if (e.key === "Alt" && s.tool === "move" && isMovable(workDoc(s), s.overlay.hoverId)) setCursor("copy");

      if (editing()) {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          exitNodeEdit();
          return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && deleteSelectedNode()) {
          e.preventDefault();
          return;
        }
      }

      if (s.tool === "pen" && penActive()) {
        if (e.key === "Enter") {
          e.preventDefault();
          penFinish(false);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          penCancel();
          setTool("move");
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          penBack();
          return;
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setCursor("grab");
        }
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        const doc = workDoc(s);
        const only = s.selection.length === 1 ? doc.elements[s.selection[0]] : undefined;
        const parents = new Set(s.selection.map((i) => doc.elements[i]?.parentId ?? null));
        let pool: string[];
        if (only && (only.type === "frame" || only.type === "group") && only.childIds.length) pool = only.childIds;
        else if (s.selection.length && parents.size === 1 && [...parents][0]) pool = doc.elements[[...parents][0]!].childIds;
        else pool = doc.rootIds;
        select(pool.filter((i) => doc.elements[i] && !doc.elements[i].locked));
        return;
      }
      if (mod && e.altKey && e.code === "KeyK") {
        e.preventDefault();
        const doc = workDoc(s);
        const ids = s.selection.filter((i) => canBeComponent(doc.elements[i]));
        for (const id of ids) dispatch("create_component", { id });
        return;
      }
      if (mod && e.altKey && e.code === "KeyB") {
        e.preventDefault();
        const doc = workDoc(s);
        for (const id of s.selection.filter((i) => doc.elements[i]?.type === "instance")) dispatch("detach_instance", { id });
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        const doc = workDoc(s);
        if (e.shiftKey) {
          const kids = s.selection.flatMap((i) => (doc.elements[i]?.type === "group" ? doc.elements[i].childIds : []));
          dispatch("ungroup", { ids: s.selection });
          if (kids.length) select(kids);
        } else if (s.selection.length) {
          const id = newId("group");
          dispatch("group_elements", { ids: s.selection, groupId: id });
          if (workDoc().elements[id]) select([id]);
        }
        return;
      }
      if (mod && e.shiftKey && key === "l") {
        e.preventDefault();
        const doc = workDoc(s);
        const els = s.selection.map((i) => doc.elements[i]).filter(Boolean);
        if (els.length) {
          const lock = !els.every((x) => x.locked);
          dispatch("set_props", { ids: els.map((x) => x.id), props: { locked: lock }, label: lock ? "Lock" : "Unlock" });
        }
        return;
      }
      if (e.shiftKey && !mod && key === "a") {
        e.preventDefault();
        const sel = s.selection.filter((id) => workDoc(s).elements[id]);
        const doc = workDoc(s);
        if (sel.length === 1 && doc.elements[sel[0]].type === "frame") {
          const f = doc.elements[sel[0]];
          dispatch("set_layout", { id: f.id, layout: f.layout ? null : defaultLayout() });
        } else if (sel.length >= 1) {
          const id = newId("frame");
          dispatch("wrap_in_layout", { ids: sel, frameId: id });
          if (workDoc().elements[id]) select([id]);
        }
        return;
      }
      if (mod && e.shiftKey && key === "k") {
        e.preventDefault();
        void pickImages();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        const payload = extractPayload(workDoc(s), s.selection);
        if (payload) pastePayload(payload, true);
        return;
      }
      if (mod) return;

      if (e.shiftKey && e.key === "!") {
        zoomToFit(sizeRef.current.w, sizeRef.current.h);
        return;
      }
      if (e.shiftKey && e.key === "@") {
        zoomToElements(getState().selection, sizeRef.current.w, sizeRef.current.h);
        return;
      }
      const tools: Record<string, Tool> = { v: "move", f: "frame", r: "rect", o: "ellipse", t: "text", h: "hand", p: "pen", z: "zoom" };
      if (tools[key]) {
        e.preventDefault();
        setTool(tools[key]);
        setCursor(tools[key] === "hand" ? "grab" : tools[key] === "zoom" ? "zoom-in" : tools[key] === "move" ? "default" : "crosshair");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selection.length) {
          e.preventDefault();
          dispatch("delete_elements", { ids: topLevelOnly(workDoc(s), s.selection) });
          select([]);
        }
        return;
      }
      if (e.key === "Escape") {
        select([]);
        setTool("move");
        return;
      }
      if (e.key === "Enter" && s.selection.length === 1 && ["frame", "group"].includes(workDoc(s).elements[s.selection[0]]?.type ?? "") && !e.shiftKey) {
        const doc = workDoc(s);
        const kids = doc.elements[s.selection[0]].childIds.filter((c) => !doc.elements[c].locked);
        if (kids.length) {
          e.preventDefault();
          select(kids);
          return;
        }
      }
      if (e.key === "Enter" && e.shiftKey && s.selection.length) {
        const doc = workDoc(s);
        const parent = doc.elements[s.selection[0]]?.parentId;
        if (parent) {
          e.preventDefault();
          select([parent]);
          return;
        }
      }
      if (e.key === "Enter" && s.selection.length === 1 && workDoc(s).elements[s.selection[0]]?.type === "text") {
        e.preventDefault();
        setEditing(s.selection[0]);
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [ax, ay] = arrows[e.key];
        nudge(topLevelOnly(workDoc(s), s.selection), ax * step, ay * step);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setCursor("default");
      }
      if (e.key === "Alt" && getState().tool === "zoom") setCursor("zoom-in");
      if (e.key === "Alt" && getState().tool === "move" && !dragRef.current) setCursor("default");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // the top bar and the layers panel can ask the canvas to move
  useEffect(() => {
    const fit = () => zoomToFit(sizeRef.current.w, sizeRef.current.h);
    const fitSelection = (e: Event) => {
      const ids = (e as CustomEvent<string[] | undefined>).detail ?? getState().selection;
      zoomToElements(ids, sizeRef.current.w, sizeRef.current.h);
    };
    const reveal = (e: Event) => revealElements((e as CustomEvent<string[]>).detail ?? [], sizeRef.current.w, sizeRef.current.h);
    const level = (e: Event) => zoomTo((e as CustomEvent<number>).detail, sizeRef.current.w, sizeRef.current.h);
    window.addEventListener("duet:fit", fit);
    window.addEventListener("duet:fit-selection", fitSelection);
    window.addEventListener("duet:zoom", level);
    window.addEventListener("duet:reveal", reveal);
    return () => {
      window.removeEventListener("duet:fit", fit);
      window.removeEventListener("duet:fit-selection", fitSelection);
      window.removeEventListener("duet:zoom", level);
      window.removeEventListener("duet:reveal", reveal);
    };
  }, []);

  // If the design has scrolled completely out of view, offer a way back.
  const docNow = useStore((s) => s.timeline[s.cursor].doc);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (docNow.rootIds.length === 0 || w === 0) return setLost(false);
    const view = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: w / viewport.zoom, height: h / viewport.zoom };
    setLost(!docNow.rootIds.some((id) => rectsIntersect(view, worldBounds(docNow, id))));
  }, [viewport, docNow]);

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const rect = wrapRef.current?.getBoundingClientRect();
        const vp = getState().viewport;
        const at = rect ? { x: (e.clientX - rect.left - vp.x) / vp.zoom, y: (e.clientY - rect.top - vp.y) / vp.zoom } : undefined;
        const files = Array.from(e.dataTransfer.files);
        // a video or a sound is not read into Duet: it is played from where it is, so its place on the computer is needed
        if (files.some((f) => clipKind(f.name))) {
          const known = droppedPaths(e.dataTransfer).filter((p) => clipKind(p));
          const clips = files.filter((f) => clipKind(f.name));
          const frame = at ? frameAt(workDoc(), at.x, at.y) : null;
          void (async () => {
            let paths = known;
            let problems: string[] = [];
            try {
              if (!frame) problems = ["Drop a clip onto a frame."];
              else {
                // when the system does not say where the file is, Duet keeps its own copy beside the projects
                if (!paths.length) paths = await keepDropped(clips);
                problems = await dropClips(frame, paths);
              }
            } catch (err) {
              problems = [String(err instanceof Error ? err.message : err)];
            }
            if (paths.length && frame && !problems.length) {
              setLayout({ mode: "motion" });
              select([frame]);
            }
            if (problems.length) void message(problems.join(" "), { title: "Duet", kind: "info" });
          })();
        }
        void placeFiles(files, at);
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = point(e);
          const doc = workDoc();
          const hit = hitTest(doc, p.x, p.y, new Set(), e.metaKey || e.ctrlKey);
          const sel = getState().selection;
          if (hit && !sel.includes(hit)) select([hit]);
          else if (!hit) select([]);
          window.dispatchEvent(new CustomEvent("duet:context", { detail: { x: e.clientX, y: e.clientY } }));
        }}
        onPointerLeave={() => !dragRef.current && getState().overlay.hoverId && setOverlay({ hoverId: null })}
      />
      {lost && (
        <button className="find" onClick={() => zoomToFit(sizeRef.current.w, sizeRef.current.h)}>
          Find your design
        </button>
      )}
      {editingId && <TextEditor key={editingId} id={editingId} zoom={viewport.zoom} vx={viewport.x} vy={viewport.y} />}
    </div>
  );
}

function normalize(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** Space between the edge of the typing box and its words: its padding and its border. */
const EDIT_EDGE = 3.5;

function TextEditor({ id, zoom, vx, vy }: { id: string; zoom: number; vx: number; vy: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const doc = workDoc();
  const el = doc.elements[id];
  const [value, setValue] = useState(el?.text ?? "");

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!el) return null;
  const pos = worldPos(doc, id);

  const finish = () => {
    const text = ref.current?.value ?? el.text;
    setEditing(null);
    if (cancelled.current) {
      if (el.text === "") dispatch("delete_elements", { ids: [id] });
      return;
    }
    if (text.trim() === "") {
      dispatch("delete_elements", { ids: [id] });
      select([]);
      return;
    }
    dispatch("set_props", { ids: [id], props: { text }, label: "Edit text" });
  };

  // The words on the canvas are hidden while you type, and this box stands exactly where they were:
  // the same lines, the same size, and the same height above the line, so nothing jumps or doubles.
  const box = layoutText({ ...el, text: value || " " });
  const width = (el.textFixed ? el.width : box.width) * zoom;
  const height = box.height * zoom;
  const lift = textLift(el) * zoom;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      spellCheck={false}
      wrap={el.textFixed ? "soft" : "off"}
      style={{
        left: pos.x * zoom + vx - EDIT_EDGE,
        top: pos.y * zoom + vy - EDIT_EDGE + lift,
        // a hair wider than the words need, so a line that only just fits is not pushed down
        width: width + (el.textFixed ? 0.5 : 4),
        height: height + Math.max(0, -lift),
        font: fontCss(el, el.fontSize * zoom),
        lineHeight: `${lineStep(el) * zoom}px`,
        letterSpacing: el.letterSpacing * zoom,
        textAlign: el.textAlign,
        color: el.fill,
        whiteSpace: el.textFixed ? "pre-wrap" : "pre",
        // turned text is typed at the angle it sits at
        transform: turnOf(el) ? `rotate(${turnOf(el)}deg)` : undefined,
        transformOrigin: `${EDIT_EDGE + (el.width * zoom) / 2}px ${EDIT_EDGE - lift + (el.height * zoom) / 2}px`,
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          cancelled.current = true;
          ref.current?.blur();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
}
