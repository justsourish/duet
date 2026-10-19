import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../state/store";
import { colorHex, docColors, hexToHsva, hsvaToHex, withOpacity } from "./color";
import type { Hsva } from "./color";
import { useDismiss } from "./useDismiss";

const W = 232;
const H = 330;

/** The browser's own eyedropper, where the system has one. Not every system does, so it is only offered when it is there. */
interface EyeDropperLike {
  open: () => Promise<{ sRGBHex: string }>;
}
const eyeDropper = (): EyeDropperLike | null => {
  const E = (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper;
  return E ? new E() : null;
};

/** Follow the pointer across a strip or square from the press until it lets go, as fractions 0 to 1. */
function dragger(onMove: (fx: number, fy: number) => void, onEnd: () => void) {
  return (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) =>
      onMove(Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)));
    e.currentTarget.setPointerCapture(e.pointerId);
    at(e);
    const el = e.currentTarget;
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

/**
 * Duet's colour picker: a square for how strong and how bright, a strip for the hue, one for how see-through,
 * the hex, and the colours the design already uses. Dragging shows the change live; letting go keeps it.
 */
export function ColorPicker({ value, at, onPreview, onCommit, onClose, tag }: { value: string | null; at: DOMRect; onPreview?: (c: string) => void; onCommit: (c: string) => void; onClose: () => void; tag: string }) {
  const [hsva, setHsva] = useState<Hsva>(() => hexToHsva(value ?? "#000000"));
  const live = useRef(hsva);
  const [text, setText] = useState(colorHex(hsvaToHex(hsva)).toUpperCase());
  const doc = useStore((s) => s.timeline[s.cursor].doc);
  const used = docColors(doc);
  useDismiss(true, onClose, `[data-cp="${tag}"]`);

  // when the colour changes from outside, like an undo, follow it, but keep the hue of a grey
  useEffect(() => {
    if (!value || hsvaToHex(live.current) === value) return;
    const next = hexToHsva(value);
    if (next.s === 0 || next.v === 0) next.h = live.current.h;
    live.current = next;
    setHsva(next);
    setText(colorHex(value).toUpperCase());
  }, [value]);

  const show = (next: Hsva) => {
    live.current = next;
    setHsva(next);
    const hex = hsvaToHex(next);
    setText(colorHex(hex).toUpperCase());
    onPreview?.(hex);
  };
  const keep = () => onCommit(hsvaToHex(live.current));
  const pick = (hex: string) => {
    const next = { ...hexToHsva(hex), a: live.current.a };
    live.current = next;
    setHsva(next);
    setText(colorHex(hex).toUpperCase());
    onCommit(hsvaToHex(next));
  };

  const square = dragger((fx, fy) => show({ ...live.current, s: fx, v: 1 - fy }), keep);
  const hue = dragger((fx) => show({ ...live.current, h: fx * 360 }), keep);
  const alpha = dragger((fx) => show({ ...live.current, a: Math.round(fx * 100) / 100 }), keep);

  const solid = colorHex(hsvaToHex(hsva));
  const pure = colorHex(hsvaToHex({ h: hsva.h, s: 1, v: 1, a: 1 }));
  const left = Math.max(8, at.left - W - 10);
  const top = Math.min(window.innerHeight - H - 8, Math.max(8, at.top - 40));
  const dropper = typeof window !== "undefined" && "EyeDropper" in window;

  return createPortal(
    <div className="cpick" data-cp={tag} style={{ left, top, width: W }} onKeyDown={(e) => e.stopPropagation()}>
      <div className="cpick-square" style={{ background: pure }} onPointerDown={square}>
        <span className="cpick-knob" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: solid }} />
      </div>
      <div className="cpick-strip cpick-hue" onPointerDown={hue}>
        <span className="cpick-knob" style={{ left: `${(hsva.h / 360) * 100}%`, background: pure }} />
      </div>
      <div className="cpick-strip cpick-alpha" onPointerDown={alpha}>
        <span className="cpick-fade" style={{ background: `linear-gradient(to right, transparent, ${solid})` }} />
        <span className="cpick-knob" style={{ left: `${hsva.a * 100}%`, background: hsvaToHex(hsva) }} />
      </div>
      <div className="cpick-row">
        {dropper && (
          <button
            type="button"
            className="cpick-drop"
            title="Pick a colour from the screen"
            onClick={() =>
              void eyeDropper()
                ?.open()
                .then((r) => pick(r.sRGBHex))
                .catch(() => undefined)
            }
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.5 2.5a2 2 0 0 1 3 3L12 7l.8.8-1.2 1.2-.8-.8-5 5H3.5v-2.3l5-5-.8-.8L8.9 3.9l.8.8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <input
          className="cpick-hex"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const t = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) pick(colorHex(t));
            else setText(solid.toUpperCase());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <input
          className="cpick-pct"
          value={Math.round(hsva.a * 100)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) {
              const next = { ...live.current, a: Math.min(100, Math.max(0, n)) / 100 };
              live.current = next;
              setHsva(next);
            }
          }}
          onBlur={keep}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className="cpick-unit">%</span>
      </div>
      {used.length > 0 && (
        <>
          <div className="cpick-label">In this design</div>
          <div className="cpick-swatches">
            {used.map((c) => (
              <button key={c} type="button" className={`cpick-sw ${c === solid ? "on" : ""}`} style={{ background: c }} title={c.toUpperCase()} onClick={() => pick(c)} />
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

let tags = 0;

/**
 * A colour in a panel: the swatch opens Duet's picker, and the hex can be typed. Typing a colour without
 * see-through keeps how see-through it was. `none` lets it be emptied, for a stroke that is not there.
 */
export function ColorField({ value, onCommit, onPreview, none }: { value: string | null; onCommit: (c: string | null) => void; onPreview?: (c: string) => void; none?: boolean }) {
  const [text, setText] = useState(value ? colorHex(value) : "");
  useEffect(() => setText(value ? colorHex(value) : ""), [value]);
  const [at, setAt] = useState<DOMRect | null>(null);
  const tag = useRef(`cp${++tags}`).current;
  const valid = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
  return (
    <div className="f color">
      <button
        type="button"
        className={`cswatch ${value ? "" : "none"} ${at ? "open" : ""}`}
        data-cp={tag}
        title="Pick a colour"
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        <span style={{ background: value ?? "transparent" }} />
      </button>
      <input
        value={text}
        placeholder={none ? "None" : ""}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const t = text.trim();
          if (t === "" && none) onCommit(null);
          else if (valid(t)) onCommit(t.length === 9 ? t : withOpacity(colorHex(t), value ? hexToHsva(value).a * 100 : 100));
          else setText(value ? colorHex(value) : "");
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {at && <ColorPicker value={value} at={at} tag={tag} onPreview={onPreview} onCommit={onCommit} onClose={() => setAt(null)} />}
    </div>
  );
}
