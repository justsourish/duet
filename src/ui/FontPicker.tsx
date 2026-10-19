import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { COMMON_FONTS } from "../canvas/text";
import { inTauri } from "../project/project";
import { fetchedFamilies, fetchFont, isFetching, matchOnline, onlineFonts, type OnlineFont } from "../project/fonts";

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

interface Row {
  name: string;
  group: string;
  /** Set on a free online font that is not fetched yet. */
  font?: OnlineFont;
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
  const [online, setOnline] = useState<OnlineFont[]>([]);
  // the free font being fetched, and why one could not be
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // the panel scrolls and would cut the list off, so the list is placed on the window under the field
  const [at, setAt] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    let alive = true;
    void computerFonts().then((l) => alive && setAll(l));
    void onlineFonts().then((l) => alive && setOnline(l));
    return () => {
      alive = false;
    };
  }, []);

  // while the box shows the font already set, every font is offered; typing narrows it
  const typed = text === value ? "" : text;
  const mine = fetchedFamilies();
  const inProject = matchFonts(mine, typed);
  const onComputer = matchFonts(all, typed).filter((f) => !mine.includes(f)).slice(0, SHOWN);
  const free = matchOnline(online, typed, new Set([...all, ...mine].map((f) => f.toLowerCase()))).slice(0, 40);
  const found: Row[] = [
    ...inProject.map((name) => ({ name, group: "In this project" })),
    ...onComputer.map((name) => ({ name, group: "On this computer" })),
    ...free.map((f) => ({ name: f.family, group: "Free online", font: f })),
  ];
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

  const pick = (row: Row) => {
    setFailed(null);
    if (!row.font) {
      setText(row.name);
      setOpen(false);
      if (row.name !== value) onCommit(row.name);
      return;
    }
    // a free font is fetched first, then used; the list stays open and shows it is working
    const font = row.font;
    setBusy(font.family);
    fetchFont(font)
      .then(() => {
        setText(font.family);
        setOpen(false);
        onCommit(font.family);
      })
      .catch(() => setFailed(`${font.family} could not be fetched. Check the internet and try again.`))
      .finally(() => setBusy(null));
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
          if (busy) return; // a font is on its way; the box stays as it is
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
            if (open && found[lit] && text !== value) {
              pick(found[lit]);
              return;
            }
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setText(value);
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      />
      {open && at && (found.length > 0 || failed) && (
        // dragging its scroll bar must not take the focus away and close it
        <div className="font-list" ref={list} style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.height }} onPointerDown={(e) => e.preventDefault()}>
          {failed && <div className="font-note">{failed}</div>}
          {found.map((f, i) => (
            <Fragment key={`${f.group}/${f.name}`}>
              {(i === 0 || found[i - 1].group !== f.group) && <div className="font-group">{f.group}</div>}
              <div
                className={`font-row ${i === lit ? "lit" : ""} ${f.name === value ? "on" : ""}`}
                style={f.font ? undefined : { fontFamily: `"${f.name}", system-ui` }}
                // picked before the box loses focus, so the click is not lost
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(f);
                }}
                onPointerEnter={() => setLit(i)}
              >
                <span>{f.name}</span>
                {f.font && <span className="font-kind">{busy === f.name || isFetching(f.name) ? "Fetching…" : f.font.category}</span>}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
