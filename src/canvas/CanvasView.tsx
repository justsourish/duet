import { useEffect, useLayoutEffect, useRef } from "react";
import { newId, runCommand } from "../commands";
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
import { draw, labelRect, screenRect } from "./render";
import { FONT_STACK, LINE_HEIGHT, measureText } from "./text";

type Drag =
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
};

export function zoomToFit(width: number, height: number) {
  const doc = currentDoc();
  const box = unionRect(doc.rootIds.map((id) => worldRect(doc, id)));
  if (!box) {
    setViewport({ x: 160, y: 100, zoom: 1 });
    return;
  }
  const pad = 120;
  const zoom = Math.max(0.05, Math.min(2, (width - pad * 2) / box.width, (height - pad * 2) / box.height));
  setViewport({
    zoom,
    x: width / 2 - (box.x + box.width / 2) * zoom,
    y: height / 2 - (box.y + box.height / 2) * zoom,
  });
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
    return () => {
      ro.disconnect();
      unsub();
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

  const zoomAt = (sx: number, sy: number, factor: number, from?: number) => {
    const vp = getState().viewport;
    const zoom = Math.max(0.05, Math.min(64, (from ?? vp.zoom) * factor));
    const ref = from ? { x: vp.x, y: vp.y, zoom: from } : vp;
    const wx = (sx - ref.x) / ref.zoom;
    const wy = (sy - ref.y) / ref.zoom;
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
      if (CREATE_TOOLS.includes(s.tool)) return setCursor(s.tool === "text" ? "text" : "crosshair");
      const h = handleAt(p.sx, p.sy);
      if (h) return setCursor(HANDLES.find((x) => x.key === h)!.cursor);
      setCursor("default");
      const doc = currentDoc(s);
      const hover = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y);
      if (hover !== s.overlay.hoverId) setOverlay({ hoverId: hover });
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (getState().editingId) return;
      const p = point(e);
      if (e.ctrlKey || e.metaKey) {
        zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * 0.01));
      } else {
        const vp = getState().viewport;
        setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY });
      }
    };
    // Safari / WebKit pinch gestures (the Mac webview)
    let gestureStart = 1;
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = getState().viewport.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      const p = point(g);
      zoomAt(p.sx, p.sy, g.scale, gestureStart);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart);
    canvas.addEventListener("gesturechange", onGestureChange);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (mod) return;

      if (e.shiftKey && e.key === "!") {
        zoomToFit(sizeRef.current.w, sizeRef.current.h);
        return;
      }
      const tools: Record<string, Tool> = { v: "move", f: "frame", r: "rect", o: "ellipse", t: "text", h: "hand" };
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

  // anything outside this component can ask for zoom-to-fit
  useEffect(() => {
    const fit = () => zoomToFit(sizeRef.current.w, sizeRef.current.h);
    window.addEventListener("duet:fit", fit);
    return () => window.removeEventListener("duet:fit", fit);
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => !dragRef.current && getState().overlay.hoverId && setOverlay({ hoverId: null })}
      />
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
