import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { COMMON_FONTS } from "../canvas/text";
import { inTauri } from "../project/project";

/** The fonts on this computer, asked for once. Outside the app, the common ones. */
let fonts: Promise<string[]> | null = null;
function computerFonts(): Promise<string[]> {
  if (!fonts) {
    fonts = inTauri()
      ? invoke<string[]>("system_fonts").then((l) => (l.length ? l : COMMON_FONTS)).catch(() => COMMON_FONTS)
      : Promise.resolve(COMMON_FONTS);
  }
  return fonts;
}

/** Each name drawn in its own font loads that font, so only this many show at once. Typing finds the rest. */
const SHOWN = 80;

/** Fonts whose name holds what was typed, the ones that start with it first. */
export function matchFonts(all: string[], typed: string): string[] {
  const t = typed.trim().toLowerCase();
  if (!t) return all;
  const starts = all.filter((f) => f.toLowerCase().startsWith(t));
  const inside = all.filter((f) => !f.toLowerCase().startsWith(t) && f.toLowerCase().includes(t));
  return [...starts, ...inside];
}

/** A font name, saved when you pick one, leave the box or press Enter, so typing does not fill the history. */
export default function FontPicker({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [all, setAll] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // the panel scrolls and would cut the list off, so the list is placed on the window under the field
  const [at, setAt] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    let alive = true;
    void computerFonts().then((l) => alive && setAll(l));
    return () => {
      alive = false;
    };
  }, []);

  // while the box shows the font already set, every font is offered; typing narrows it
  const found = matchFonts(all, text === value ? "" : text).slice(0, SHOWN);
  useEffect(() => setLit(0), [text]);
  useEffect(() => {
    const field = box.current?.closest(".f") ?? box.current;
    if (!open || !field) return;
    const r = field.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    // too little room below: open upwards
    setAt(below >= 200 ? { left: r.left, top: r.bottom + 4, width: r.width, height: Math.min(320, below) } : { left: r.left, top: Math.max(12, r.top - 4 - 320), width: r.width, height: Math.min(320, r.top - 16) });
  }, [open]);
  useEffect(() => {
    list.current?.children[lit]?.scrollIntoView({ block: "nearest" });
  }, [lit]);

  const pick = (name: string) => {
    setText(name);
    setOpen(false);
    if (name !== value) onCommit(name);
  };

  return (
    <div className="font-picker" ref={box}>
      <input
        value={text}
        placeholder="System font"
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          if (text.trim() !== value) onCommit(text.trim());
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setLit((i) => Math.max(0, Math.min(found.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
          }
          if (e.key === "Enter") {
            if (open && found[lit] && text !== value) pick(found[lit]);
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setText(value);
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      {open && at && found.length > 0 && (
        // dragging its scroll bar must not take the focus away and close it
        <div className="font-list" ref={list} style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.height }} onPointerDown={(e) => e.preventDefault()}>
          {found.map((f, i) => (
            <div
              key={f}
              className={`font-row ${i === lit ? "lit" : ""} ${f === value ? "on" : ""}`}
              style={{ fontFamily: `"${f}", system-ui` }}
              // picked before the box loses focus, so the click is not lost
              onPointerDown={(e) => {
                e.preventDefault();
                pick(f);
              }}
              onPointerEnter={() => setLit(i)}
            >
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
