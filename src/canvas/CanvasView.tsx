import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { newId, runCommand } from "../commands";
import { extractPayload, payloadToText, textToPayload } from "../document/clipboard";
import type { ClipPayload } from "../document/clipboard";
import {
  descendants,
  frameAt,
  hitTest,
  rectsIntersect,
  snapRect,
  topLevelOnly,
  unionRect,
  worldPos,
  worldRect,
} from "../document/geometry";
import type { Doc, ElementType, Rect } from "../document/types";
import {
  clearOverlay,
  currentDoc,
  dispatch,
  dragBase,
  dragCancel,
  dragCommit,
  dragPreview,
  dragPreviewDoc,
  getState,
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
import { HANDLES, resizeRect } from "./handles";
import type { HandleKey } from "./handles";
import { pickImages, placeFiles } from "../project/imageImport";
import { penActive, penBack, penCancel, penDown, penDrag, penFinish, penHover } from "./pen";
import { draw, labelRect, screenRect } from "./render";
import { FONT_STACK, LINE_HEIGHT, measureText } from "./text";

type Drag =
  | { kind: "pen"; index: number | null }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "create"; type: ElementType; start: { x: number; y: number }; parentId: string | null; sx: number; sy: number }
  | { kind: "move"; start: { x: number; y: number }; ids: string[]; base: Doc; moved: boolean; sx: number; sy: number }
  | { kind: "resize"; handle: HandleKey; id: string; orig: Rect; sx: number; sy: number; start: { x: number; y: number } }
  | { kind: "marquee"; start: { x: number; y: number }; prev: string[]; additive: boolean };

const CREATE_TOOLS: Tool[] = ["frame", "rect", "ellipse", "text"];
const DEFAULT_SIZE: Record<ElementType, { w: number; h: number }> = {
  frame: { w: 360, h: 640 },
  rect: { w: 120, h: 120 },
  ellipse: { w: 120, h: 120 },
  text: { w: 40, h: 21 },
  image: { w: 240, h: 160 },
  path: { w: 100, h: 100 },
};

/** Copy of what was last copied inside this window, in case the system clipboard is unavailable. */
let inMemoryClip: ClipPayload | null = null;

/** Paste a payload where it makes sense: inside a selected frame, otherwise next to the original. */
export function pastePayload(payload: ClipPayload, duplicate = false) {
  const s = getState();
  const doc = currentDoc(s);
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

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

function fitBox(box: Rect, width: number, height: number, maxZoom: number) {
  const pad = 120;
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, (width - pad * 2) / box.width, (height - pad * 2) / box.height));
  setViewport({
    zoom,
    x: width / 2 - (box.x + box.width / 2) * zoom,
    y: height / 2 - (box.y + box.height / 2) * zoom,
  });
}

/** Show everything on the page. */
export function zoomToFit(width: number, height: number) {
  const doc = currentDoc();
  const box = unionRect(doc.rootIds.map((id) => worldRect(doc, id)));
  if (!box) return setViewport({ x: 160, y: 100, zoom: 1 });
  fitBox(box, width, height, 2);
}

/** Jump to whatever is selected, or to the given elements. */
export function zoomToElements(ids: string[], width: number, height: number) {
  const doc = currentDoc();
  const box = unionRect(ids.filter((i) => doc.elements[i]).map((id) => worldRect(doc, id)));
  if (!box) return;
  fitBox(box, width, height, 4);
}

/** Bring things into view only if they are off screen, keeping the zoom when they fit. */
export function revealElements(ids: string[], width: number, height: number) {
  const doc = currentDoc();
  const box = unionRect(ids.filter((i) => doc.elements[i]).map((id) => worldRect(doc, id)));
  if (!box) return;
  const vp = getState().viewport;
  const left = box.x * vp.zoom + vp.x;
  const top = box.y * vp.zoom + vp.y;
  const right = left + box.width * vp.zoom;
  const bottom = top + box.height * vp.zoom;
  const visible = left >= 0 && top >= 0 && right <= width && bottom <= height;
  if (visible) return;
  if (box.width * vp.zoom <= width * 0.9 && box.height * vp.zoom <= height * 0.9) {
    setViewport({ zoom: vp.zoom, x: width / 2 - (box.x + box.width / 2) * vp.zoom, y: height / 2 - (box.y + box.height / 2) * vp.zoom });
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
  setViewport({ zoom, x: width / 2 - wx * zoom, y: height / 2 - wy * zoom });
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
      draw(ctx, getState(), w, h, dpr);
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
    const doc = currentDoc(s);
    if (s.selection.length !== 1 || !doc.elements[s.selection[0]]) return null;
    const r = screenRect(s, worldRect(doc, s.selection[0]));
    for (const hd of HANDLES) {
      const hx = r.x + r.width * hd.fx;
      const hy = r.y + r.height * hd.fy;
      if (Math.abs(sx - hx) <= 6 && Math.abs(sy - hy) <= 6) return hd.key;
    }
    return null;
  };

  const labelAt = (sx: number, sy: number): string | null => {
    const s = getState();
    const doc = currentDoc(s);
    for (let i = doc.rootIds.length - 1; i >= 0; i--) {
      const id = doc.rootIds[i];
      if (doc.elements[id]?.type !== "frame") continue;
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
      dragRef.current = { kind: "pan", sx: p.sx, sy: p.sy, vx: s.viewport.x, vy: s.viewport.y };
      setCursor("grabbing");
      return;
    }

    if (s.tool === "pen") {
      dragRef.current = { kind: "pen", index: penDown(p, s.viewport.zoom) };
      return;
    }

    if (CREATE_TOOLS.includes(s.tool)) {
      const type = s.tool as ElementType;
      const parentId = frameAt(currentDoc(s), p.x, p.y);
      dragRef.current = { kind: "create", type, start: { x: p.x, y: p.y }, parentId, sx: p.sx, sy: p.sy };
      return;
    }

    // move tool
    const doc = currentDoc(s);
    const handle = handleAt(p.sx, p.sy);
    if (handle) {
      const id = s.selection[0];
      dragRef.current = { kind: "resize", handle, id, orig: worldRect(doc, id), sx: p.sx, sy: p.sy, start: { x: p.x, y: p.y } };
      return;
    }

    const hit = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y);
    if (hit) {
      if (e.shiftKey) {
        const has = s.selection.includes(hit);
        select(has ? s.selection.filter((i) => i !== hit) : [...s.selection, hit]);
        if (has) return;
      } else if (!s.selection.includes(hit)) {
        select([hit]);
      }
      const ids = topLevelOnly(doc, getState().selection);
      dragRef.current = { kind: "move", start: { x: p.x, y: p.y }, ids, base: dragBase(), moved: false, sx: p.sx, sy: p.sy };
      return;
    }

    if (!e.shiftKey) select([]);
    dragRef.current = { kind: "marquee", start: { x: p.x, y: p.y }, prev: e.shiftKey ? s.selection : [], additive: e.shiftKey };
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
      const h = handleAt(p.sx, p.sy);
      if (h) return setCursor(HANDLES.find((x) => x.key === h)!.cursor);
      setCursor("default");
      const doc = currentDoc(s);
      const hover = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y);
      if (hover !== s.overlay.hoverId) setOverlay({ hoverId: hover });
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

    if (d.kind === "create") {
      const rect = normalize(d.start.x, d.start.y, p.x, p.y);
      setOverlay({ draft: { type: d.type, rect } });
      return;
    }

    if (d.kind === "move") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
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
          .map((id) => worldRect(d.base, id));
        const box = unionRect(d.ids.map((id) => worldRect(d.base, id)));
        if (box) {
          const snap = snapRect({ ...box, x: box.x + dx, y: box.y + dy }, others, 6 / s.viewport.zoom);
          dx += snap.dx;
          dy += snap.dy;
          guidesX = snap.guidesX;
          guidesY = snap.guidesY;
        }
      }
      dragPreview("move_elements", { ids: d.ids, dx, dy });
      setOverlay({ guidesX, guidesY });
      return;
    }

    if (d.kind === "resize") {
      const rect = resizeRect(d.orig, d.handle, p.x - d.start.x, p.y - d.start.y);
      const doc = dragBase();
      const el = doc.elements[d.id];
      const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
      dragPreview("resize_element", { id: d.id, x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height });
      return;
    }

    if (d.kind === "marquee") {
      const rect = normalize(d.start.x, d.start.y, p.x, p.y);
      const doc = currentDoc(s);
      const inside = doc.rootIds.filter((id) => rectsIntersect(rect, worldRect(doc, id)));
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

    if (d.kind === "pen") return;

    if (d.kind === "pan") {
      setCursor(spaceRef.current ? "grab" : "default");
      return;
    }

    if (d.kind === "create") {
      const dragged = Math.hypot(p.sx - d.sx, p.sy - d.sy) >= 4;
      const size = DEFAULT_SIZE[d.type];
      const world = dragged
        ? normalize(d.start.x, d.start.y, p.x, p.y)
        : { x: d.start.x, y: d.start.y, width: size.w, height: size.h };
      const doc = currentDoc();
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
        let label = d.ids.length > 1 ? `Move ${d.ids.length} elements` : "Move element";
        const doc = d.base;
        // Dropped over a different frame (or off every frame)? Change parent, like Figma.
        if (d.ids.every((id) => doc.elements[id]?.type !== "frame")) {
          const target = frameAt(doc, p.x, p.y);
          const changing = d.ids.filter((id) => (doc.elements[id].parentId ?? null) !== target);
          if (changing.length > 0) {
            const name = target ? doc.elements[target].name : null;
            label = name ? `Move into ${name}` : "Move out of frame";
            dragPreviewDoc(runCommand(currentDoc(), "reparent_elements", { ids: changing, parentId: target, label }));
          }
        }
        dragCommit(label);
      } else dragCancel();
      setOverlay({ guidesX: [], guidesY: [] });
      return;
    }

    if (d.kind === "resize") {
      dragCommit("Resize element");
      return;
    }

    if (d.kind === "marquee") setOverlay({ marquee: null });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (getState().tool === "pen") {
      if (penActive()) penFinish(false);
      return;
    }
    const p = point(e);
    const doc = currentDoc();
    const hit = hitTest(doc, p.x, p.y);
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
      const payload = extractPayload(currentDoc(s), s.selection);
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
        select([...currentDoc(s).rootIds]);
        return;
      }
      if (mod && e.shiftKey && key === "k") {
        e.preventDefault();
        void pickImages();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        const payload = extractPayload(currentDoc(s), s.selection);
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
      const tools: Record<string, Tool> = { v: "move", f: "frame", r: "rect", o: "ellipse", t: "text", h: "hand", p: "pen" };
      if (tools[key]) {
        e.preventDefault();
        setTool(tools[key]);
        setCursor(tools[key] === "hand" ? "grab" : tools[key] === "move" ? "default" : "crosshair");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selection.length) {
          e.preventDefault();
          dispatch("delete_elements", { ids: topLevelOnly(currentDoc(s), s.selection) });
          select([]);
        }
        return;
      }
      if (e.key === "Escape") {
        select([]);
        setTool("move");
        return;
      }
      if (e.key === "Enter" && s.selection.length === 1 && currentDoc(s).elements[s.selection[0]]?.type === "text") {
        e.preventDefault();
        setEditing(s.selection[0]);
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [ax, ay] = arrows[e.key];
        dispatch("move_elements", { ids: topLevelOnly(currentDoc(s), s.selection), dx: ax * step, dy: ay * step });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setCursor("default");
      }
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
    setLost(!docNow.rootIds.some((id) => rectsIntersect(view, worldRect(docNow, id))));
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
        void placeFiles(Array.from(e.dataTransfer.files), at);
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => !dragRef.current && getState().overlay.hoverId && setOverlay({ hoverId: null })}
      />
      {lost && (
        <button className="find" onClick={() => zoomToFit(sizeRef.current.w, sizeRef.current.h)}>
          Find your design
        </button>
      )}
      {editingId && <TextEditor id={editingId} zoom={viewport.zoom} vx={viewport.x} vy={viewport.y} />}
    </div>
  );
}

function normalize(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function TextEditor({ id, zoom, vx, vy }: { id: string; zoom: number; vx: number; vy: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const doc = currentDoc();
  const el = doc.elements[id];

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!el) return null;
  const pos = worldPos(doc, id);

  const finish = () => {
    const value = ref.current?.value ?? el.text;
    setEditing(null);
    if (cancelled.current) {
      if (el.text === "") dispatch("delete_elements", { ids: [id] });
      return;
    }
    if (value.trim() === "") {
      dispatch("delete_elements", { ids: [id] });
      select([]);
      return;
    }
    const m = measureText(value, el.fontSize);
    dispatch("set_props", { ids: [id], props: { text: value, width: Math.max(8, m.width + 2), height: m.height }, label: "Edit text" });
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      defaultValue={el.text}
      spellCheck={false}
      style={{
        left: pos.x * zoom + vx - 2,
        top: pos.y * zoom + vy - 2,
        fontSize: el.fontSize * zoom,
        lineHeight: LINE_HEIGHT,
        fontFamily: FONT_STACK,
        color: el.fill,
        minWidth: 40,
      }}
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
