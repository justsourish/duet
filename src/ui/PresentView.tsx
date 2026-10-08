import { useEffect, useRef, useState } from "react";
import { drawElement } from "../canvas/render";
import { ancestors, hitTest, worldPos } from "../document/geometry";
import type { Doc } from "../document/types";
import { currentDoc, getState } from "../state/store";

/** The screen to start on: the selected screen, or the one holding the selection, or the first one. */
export function startFrame(doc: Doc, selection: string[]): string | null {
  for (const id of selection) {
    const chain = [id, ...ancestors(doc, id)];
    const frame = chain.find((c) => doc.elements[c]?.type === "frame");
    if (frame) return frame;
  }
  return doc.rootIds.find((i) => doc.elements[i]?.type === "frame") ?? null;
}

/** Which screen does a click at this spot lead to? Looks at what was clicked and everything around it. */
export function linkAt(doc: Doc, frameId: string, wx: number, wy: number): string | null {
  const hit = hitTest(doc, wx, wy);
  if (!hit) return null;
  const chain = [hit, ...ancestors(doc, hit)];
  if (!chain.includes(frameId)) return null;
  for (const id of chain) {
    const target = doc.elements[id]?.link;
    if (target && doc.elements[target]?.type === "frame") return target;
    if (id === frameId) break;
  }
  return null;
}

export default function PresentView({ onClose }: { onClose: () => void }) {
  const doc = useRef<Doc>(currentDoc()).current;
  const first = useRef(startFrame(doc, getState().selection)).current;
  const [current, setCurrent] = useState<string | null>(first);
  const [trail, setTrail] = useState<string[]>([]);
  const [hot, setHot] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef({ ox: 0, oy: 0, scale: 1 });

  const go = (id: string) => {
    if (id === current || !current) return;
    setTrail((t) => [...t, current]);
    setCurrent(id);
  };
  const back = () => {
    setTrail((t) => {
      if (t.length === 0) return t;
      setCurrent(t[t.length - 1]);
      return t.slice(0, -1);
    });
  };

  // draw the current screen, as large as fits
  useEffect(() => {
    const c = canvas.current;
    const el = current ? doc.elements[current] : null;
    if (!c || !el) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth;
      const H = window.innerHeight;
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      const scale = Math.min((W - 64) / el.width, (H - 96) / el.height);
      const ox = (W - el.width * scale) / 2;
      const oy = (H - el.height * scale) / 2 + 12;
      layout.current = { ox, oy, scale };
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0b0d";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      drawElement(ctx, doc, { ...el, x: 0, y: 0 }, 0, 0);
      ctx.restore();
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [current, doc]);

  // while presenting, no key may reach the editor underneath
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" || e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const target = (e: React.MouseEvent): string | null => {
    if (!current) return null;
    const { ox, oy, scale } = layout.current;
    const origin = worldPos(doc, current);
    const wx = origin.x + (e.clientX - ox) / scale;
    const wy = origin.y + (e.clientY - oy) / scale;
    return linkAt(doc, current, wx, wy);
  };

  if (!current) {
    return (
      <div className="present">
        <div className="present-empty">
          Draw a screen first, then link things to other screens.
          <button className="mini" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="present">
      <div className="present-bar">
        <span>{doc.elements[current].name}</span>
        <span className="muted">Click the things you linked. Left arrow goes back. Esc closes.</span>
        <span className="spacer" />
        <button className="mini" disabled={trail.length === 0} onClick={back}>
          Back
        </button>
        <button className="mini" onClick={onClose}>
          Close
        </button>
      </div>
      <canvas
        ref={canvas}
        style={{ cursor: hot ? "pointer" : "default" }}
        onMouseMove={(e) => setHot(!!target(e))}
        onClick={(e) => {
          const t = target(e);
          if (t) go(t);
        }}
      />
    </div>
  );
}
