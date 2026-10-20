import { useLayoutEffect, useRef } from "react";
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
function fitIn(el: El, w: number, h: number) {
  const k = Math.min((w - 16) / el.width, (h - 16) / el.height);
  return { k, ox: (w - el.width * k) / 2, oy: (h - el.height * k) / 2 };
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
      const { k, ox, oy } = fitIn(root, w, h);
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
    const { k, ox, oy } = fitIn(root, r.width, r.height);
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
      <p className="ba-note">Click a picture to pick it. Click around them to see the whole board.</p>
    </div>
  );
}
