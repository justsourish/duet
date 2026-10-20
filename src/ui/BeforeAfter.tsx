import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { drawElement, setPlainPictures } from "../canvas/render";
import { canGrade } from "../document/grade";
import { worldRect } from "../document/geometry";
import type { Doc, El } from "../document/types";
import { getState, seenDoc, select, subscribe, useStore } from "../state/store";
import { pickedColour, pickingColour } from "./colourPick";
import { hexToHsva } from "./color";

/** The thing on the board that holds this one: a frame, a group, or a picture on its own. */
export function rootOf(doc: Doc, id: string | undefined): El | null {
  let el = id ? doc.elements[id] : undefined;
  while (el?.parentId) el = doc.elements[el.parentId];
  return el ?? null;
}

/** Where the thing fits inside a window, keeping its shape, with a little room around it. */
/** How far in the two windows are looking, and where: both windows share it, so they always see the same spot. */
interface View {
  zoom: number;
  x: number;
  y: number;
}
const FIT: View = { zoom: 1, x: 0, y: 0 };

function fitIn(el: El, w: number, h: number, view: View = FIT) {
  const k = Math.min((w - 16) / el.width, (h - 16) / el.height) * view.zoom;
  return { k, ox: (w - el.width * k) / 2 + view.x, oy: (h - el.height * k) / 2 + view.y };
}

/** The picture or clip under a point in the window, the one on top first. */
function pictureAt(doc: Doc, root: El, x: number, y: number): string | null {
  const base = worldRect(doc, root.id);
  const found: string[] = [];
  const walk = (el: El) => {
    if (el.hidden) return;
    if (canGrade(el)) {
      const r = worldRect(doc, el.id);
      const lx = r.x - base.x;
      const ly = r.y - base.y;
      if (x >= lx && y >= ly && x <= lx + r.width && y <= ly + r.height) found.push(el.id);
    }
    for (const id of el.childIds ?? []) if (doc.elements[id]) walk(doc.elements[id]);
  };
  walk(root);
  return found.pop() ?? null;
}

/**
 * Colour's two windows: the same moment twice, as it came on the left and with its colour on the right.
 * Change a slider and only the right one moves. Click a picture to pick it; click around them for the board.
 */
export default function BeforeAfter() {
  const selection = useStore((s) => s.selection);
  const rootId = useStore((s) => rootOf(seenDoc(s), s.selection[0])?.id ?? null);
  const before = useRef<HTMLCanvasElement>(null);
  const after = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>(FIT);
  const [looking, setLooking] = useState<View>(FIT);
  const look = (v: View) => {
    view.current = v;
    setLooking(v);
    window.dispatchEvent(new Event("duet:repaint"));
  };

  // Pinch or Cmd and scroll zooms where the pointer is; two fingers move the view. Both windows move together.
  useEffect(() => {
    view.current = FIT;
    setLooking(FIT);
    const root = () => seenDoc(getState()).elements[rootId ?? ""];
    const zoomAt = (box: HTMLElement, cx: number, cy: number, factor: number) => {
      const el = root();
      if (!el) return;
      const r = box.getBoundingClientRect();
      const v = view.current;
      const z = Math.max(1, Math.min(32, v.zoom * factor));
      const { k, ox, oy } = fitIn(el, r.width, r.height, v);
      const wx = (cx - ox) / k;
      const wy = (cy - oy) / k;
      const next = fitIn(el, r.width, r.height, { ...v, zoom: z, x: 0, y: 0 });
      const nk = next.k;
      look(z === 1 ? FIT : { zoom: z, x: cx - wx * nk - next.ox, y: cy - wy * nk - next.oy });
    };
    const boxes = Array.from(document.querySelectorAll<HTMLElement>(".ba-pic"));
    const undo: (() => void)[] = [];
    for (const box of boxes) {
      let pinch: number | null = null;
      const local = (e: { clientX: number; clientY: number }) => {
        const r = box.getBoundingClientRect();
        return { cx: e.clientX - r.left, cy: e.clientY - r.top };
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          if (pinch !== null) return;
          const { cx, cy } = local(e);
          zoomAt(box, cx, cy, Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.01));
        } else if (view.current.zoom > 1) {
          const v = view.current;
          look({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
        }
      };
      const onStart = (e: Event) => {
        e.preventDefault();
        pinch = view.current.zoom;
      };
      const onChange = (e: Event) => {
        e.preventDefault();
        if (pinch === null) return;
        const g = e as Event & { scale: number; clientX: number; clientY: number };
        const { cx, cy } = local(g);
        zoomAt(box, cx, cy, (pinch * g.scale) / view.current.zoom);
      };
      const onEnd = (e: Event) => {
        e.preventDefault();
        pinch = null;
      };
      box.addEventListener("wheel", onWheel, { passive: false });
      box.addEventListener("gesturestart", onStart);
      box.addEventListener("gesturechange", onChange);
      box.addEventListener("gestureend", onEnd);
      undo.push(() => {
        box.removeEventListener("wheel", onWheel);
        box.removeEventListener("gesturestart", onStart);
        box.removeEventListener("gesturechange", onChange);
        box.removeEventListener("gestureend", onEnd);
      });
    }
    return () => undo.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId]);

  useLayoutEffect(() => {
    if (!rootId) return;
    let raf = 0;
    const paint = (c: HTMLCanvasElement | null, plain: boolean) => {
      const box = c?.parentElement;
      const ctx = c?.getContext("2d");
      if (!c || !box || !ctx) return;
      const doc = seenDoc(getState());
      const root = doc.elements[rootId];
      if (!root) return;
      const dpr = window.devicePixelRatio || 1;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) {
        c.width = Math.max(1, Math.floor(w * dpr));
        c.height = Math.max(1, Math.floor(h * dpr));
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { k, ox, oy } = fitIn(root, w, h, view.current);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(k, k);
      // what lies outside the frame stays outside the window
      ctx.beginPath();
      ctx.rect(0, 0, root.width, root.height);
      ctx.clip();
      setPlainPictures(plain);
      try {
        drawElement(ctx, doc, { ...root, x: 0, y: 0 }, 0, 0);
      } finally {
        setPlainPictures(false);
        ctx.restore();
      }
      // the picked pictures wear a thin line in the After window
      if (!plain) {
        const base = worldRect(doc, rootId);
        ctx.strokeStyle = "#7c5cff";
        ctx.lineWidth = 1.5;
        for (const id of getState().selection) {
          if (id === rootId || !doc.elements[id] || !canGrade(doc.elements[id])) continue;
          const r = worldRect(doc, id);
          ctx.strokeRect(ox + (r.x - base.x) * k, oy + (r.y - base.y) * k, r.width * k, r.height * k);
        }
      }
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paint(before.current, true);
        paint(after.current, false);
      });
    };
    schedule();
    const unsub = subscribe(schedule);
    const ro = new ResizeObserver(schedule);
    if (before.current?.parentElement) ro.observe(before.current.parentElement);
    if (after.current?.parentElement) ro.observe(after.current.parentElement);
    window.addEventListener("duet:repaint", schedule);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      window.removeEventListener("duet:repaint", schedule);
    };
  }, [rootId]);

  if (!rootId) return null;

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    // picking one colour: read it from the picture as it came, where it was clicked
    if (pickingColour()) {
      const r = e.currentTarget.getBoundingClientRect();
      const c = before.current;
      const px = c?.getContext("2d")?.getImageData(Math.round(((e.clientX - r.left) / r.width) * c.width), Math.round(((e.clientY - r.top) / r.height) * c.height), 1, 1).data;
      if (px) pickedColour(hexToHsva(`#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`).h / 360);
      return;
    }
    const doc = seenDoc(getState());
    const root = doc.elements[rootId];
    if (!root) return;
    const r = e.currentTarget.getBoundingClientRect();
    const { k, ox, oy } = fitIn(root, r.width, r.height, view.current);
    const id = pictureAt(doc, root, (e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k);
    if (!id) return;
    if (e.shiftKey) select(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    else select([id]);
  };

  return (
    <div className="before-after" onPointerDown={() => select([])}>
      <div className="ba-window">
        <span className="ba-name">Before</span>
        <div className="ba-pic">
          <canvas ref={before} onPointerDown={pick} />
        </div>
      </div>
      <div className="ba-window">
        <span className="ba-name on">After</span>
        <div className="ba-pic">
          <canvas ref={after} onPointerDown={pick} />
        </div>
      </div>
      <p className="ba-note">
        Click a picture to pick it. Click around them to see the whole board. Pinch or Cmd and scroll to zoom both windows.
        {looking.zoom > 1 && (
          <button className="pill" data-name="ba-fit" onClick={(e) => { e.stopPropagation(); look(FIT); }}>
            Fit
          </button>
        )}
      </p>
    </div>
  );
}
