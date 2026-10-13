import { useEffect, useRef, useState } from "react";
import { cuttable, newId, runCommand } from "../commands";
import { ENTRANCES, entranceOf, spanOf } from "../document/time";
import type { Entrance } from "../document/time";
import { MOVING } from "../document/types";
import type { Doc, El } from "../document/types";
import { currentDoc, dispatch, dragBase, dragCommit, dragPreview, dragPreviewDoc, getState, restoreDoc, select, useStore } from "../state/store";
import { clipLength } from "../video/clips";
import { openScene, pause, play, seek, togglePlay } from "../video/play";
import { addClips, exportScene, stopExport } from "../video/scene";
import { setLayout, useLayout } from "./layout";

/** Time under the canvas: a row for each thing in a frame that plays, when it shows, and where the clock is. */

const NAMES = 150;
const SHORTEST = 0.1;

const clockText = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

const ENTRANCE_NAMES: Record<Entrance, string> = {
  none: "Straight away",
  fade: "Fade",
  "slide-left": "Slide from the right",
  "slide-right": "Slide from the left",
  "slide-up": "Slide up",
  "slide-down": "Slide down",
  grow: "Grow",
};

/** The frame on the page that holds this thing. */
function pageFrame(doc: Doc, id: string | undefined): El | null {
  let el = id ? doc.elements[id] : undefined;
  while (el?.parentId) el = doc.elements[el.parentId];
  return el?.type === "frame" ? el : null;
}

export default function TimeStrip() {
  const mode = useLayout((d) => d.mode);
  const look = useLayout((d) => d.timeLook ?? "layers");
  const doc = useStore((s) => currentDoc(s));
  const selection = useStore((s) => s.selection);
  const clock = useStore((s) => s.clock);
  const lanes = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [making, setMaking] = useState<number | null>(null);
  const [note, setNote] = useState("");

  // what is selected decides which frame is open, and with nothing selected the open one stays
  const frame = pageFrame(doc, selection[0]) ?? (clock.scene ? (doc.elements[clock.scene] ?? null) : null);
  const plays = !!frame && frame.duration > 0;
  const sceneId = mode === "motion" && plays ? frame.id : null;
  useEffect(() => openScene(sceneId), [sceneId]);

  useEffect(() => {
    const el = lanes.current;
    if (!el) return;
    const see = new ResizeObserver(() => setWide(Math.max(100, el.clientWidth - NAMES)));
    see.observe(el);
    return () => see.disconnect();
  }, [plays]);

  // cutting keys, the ones video editors already have in their hands
  useEffect(() => {
    if (!sceneId) return;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable))) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        e.stopPropagation();
        setZoom((z) => z * 1.5);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        e.stopPropagation();
        setZoom((z) => Math.max(1, z / 1.5));
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        e.stopPropagation();
        setZoom(1);
        if (lanes.current) lanes.current.scrollLeft = 0;
        return;
      }
      const k = e.key.toLowerCase();
      if (!["s", "d", "q", "w", "k", "l"].includes(k)) return;
      e.preventDefault();
      e.stopPropagation();
      if (k === "l") return play();
      if (k === "k") return pause();
      const s = getState();
      const now = currentDoc(s);
      const t = s.clock.t;
      const mine = s.selection.filter((id) => now.elements[id]?.parentId === sceneId);
      // what is selected is cut, and with nothing selected under the playhead, everything there is
      let under = cuttable(now, sceneId, t, mine.length ? mine : undefined);
      if (!under.length) under = cuttable(now, sceneId, t);
      if (k === "s") {
        if (under.length) dispatch("split_at", { sceneId, t, ids: under });
        return;
      }
      if (k === "d") {
        if (mine.length) dispatch("ripple_delete", { ids: mine });
        return;
      }
      if (!under.length) return;
      // Q takes away what comes before the playhead, W what comes after, and the gap closes
      const newIds = Object.fromEntries(under.map((id) => [id, newId(now.elements[id].type)]));
      const cut = runCommand(now, "split_at", { sceneId, t, ids: under, newIds });
      const out = runCommand(cut, "ripple_delete", { ids: k === "q" ? under : Object.values(newIds) });
      restoreDoc(out, k === "q" ? "Cut away what comes before" : "Cut away what comes after");
      if (k === "q") {
        seek(Math.min(...under.map((id) => now.elements[id].start)));
        select(Object.values(newIds));
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [sceneId]);

  const length = frame?.duration ?? 0;
  const laneWidth = wide * zoom;
  const pps = length > 0 ? laneWidth / length : 1;

  useEffect(() => {
    if (!clock.playing || zoom <= 1) return;
    const el = lanes.current;
    if (!el) return;
    const headX = NAMES + clock.t * pps;
    const leftVisible = el.scrollLeft + NAMES;
    const rightVisible = el.scrollLeft + el.clientWidth;
    if (headX > rightVisible - 20) {
      el.scrollLeft = headX - el.clientWidth + 40;
    } else if (headX < leftVisible) {
      el.scrollLeft = Math.max(0, headX - NAMES);
    }
  }, [clock.playing, clock.t, pps, zoom]);

  useEffect(() => {
    if (zoom === 1 && lanes.current) {
      lanes.current.scrollLeft = 0;
    }
  }, [zoom]);

  if (mode !== "motion") return null;
  if (!plays) {
    if (frame && selection.length === 1 && selection[0] === frame.id) {
      return (
        <section className="time still">
          <button className="pill" data-name="make-video" onClick={() => dispatch("set_duration", { id: frame.id, seconds: 10 })} title="Give this frame a length, so what is in it can appear, move and leave">
            Make this frame a scene
          </button>
        </section>
      );
    }
    return (
      <section className="time still">
        <span className="time-quiet">Select a frame to make it a scene.</span>
      </section>
    );
  }

  const things = frame.childIds.map((id) => doc.elements[id]).filter(Boolean).reverse();
  const nonVideos = things.filter((el) => el.type !== "video");
  const videoClips = things.filter((el) => el.type === "video");

  const packTracks = (list: El[]) => {
    const res: El[][] = [];
    for (const el of list) {
      const span = spanOf(el, frame);
      let placed = false;
      for (const track of res) {
        const overlaps = track.some((existing) => {
          const exSpan = spanOf(existing, frame);
          return span.start < exSpan.end - 0.001 && exSpan.start < span.end - 0.001;
        });
        if (!overlaps) {
          track.push(el);
          placed = true;
          break;
        }
      }
      if (!placed) res.push([el]);
    }
    return res;
  };

  interface DisplayRow {
    key: string;
    name: string;
    items: El[];
    onClick?: () => void;
  }

  const displayRows: DisplayRow[] =
    look === "layers"
      ? things.map((el) => ({
          key: el.id,
          name: el.name,
          items: [el],
          onClick: () => select([el.id]),
        }))
      : [
          ...packTracks(nonVideos).map((items, i) => ({
            key: `track-${i + 1}`,
            name: `Track ${i + 1}`,
            items,
          })),
          ...packTracks(videoClips).map((items, i) => ({
            key: `clips-${i + 1}`,
            name: `Clips ${i + 1}`,
            items,
          })),
        ];

  const picked = selection.length === 1 && selection[0] !== frame.id && pageFrame(doc, selection[0])?.id === frame.id ? doc.elements[selection[0]] : null;

  const scrub = (e: React.PointerEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = (clientX: number) => seek((clientX - box.left) / pps);
    pause();
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const drag = (e: React.PointerEvent, el: El, part: "all" | "start" | "end") => {
    e.stopPropagation();
    select([el.id]);
    const from = e.clientX;
    const span = spanOf(el, frame);
    const long = span.end - span.start;
    // a clip cannot show more than its file holds
    const file = el.type === "video" ? clipLength(el.src) : 0;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const by = (ev.clientX - from) / pps;
      if (Math.abs(ev.clientX - from) < 2 && !moved) return;
      moved = true;
      if (part === "all") {
        const start = Math.max(0, span.start + by);
        // dragged past the end, the frame grows to hold it
        const base = start + long > length ? runCommand(dragBase(), "set_duration", { id: frame.id, seconds: start + long }) : dragBase();
        dragPreviewDoc(runCommand(base, "set_timing", { ids: [el.id], start, end: start + long }));
      } else if (part === "start") {
        const least = el.type === "video" ? span.start - el.clipFrom : 0;
        const start = Math.max(0, least, Math.min(span.end - SHORTEST, span.start + by));
        dragPreview("set_timing", { ids: [el.id], start, end: span.end, ...(el.type === "video" ? { clipFrom: el.clipFrom + (start - span.start) } : {}) });
      } else {
        const most = file ? span.start + file - el.clipFrom : length;
        const end = Math.max(span.start + SHORTEST, Math.min(length, most, span.end + by));
        dragPreview("set_timing", { ids: [el.id], start: span.start, end });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) dragCommit("Change when it shows");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const make = async () => {
    setNote("");
    setMaking(0);
    try {
      const file = await exportScene(frame.id, setMaking);
      if (file) setNote(`Saved ${file.split(/[\\/]/).pop()}`);
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    } finally {
      setMaking(null);
    }
  };

  const bring = async () => {
    setNote("");
    const problems = await addClips(frame.id).catch((e) => [String(e)]);
    if (problems.length) setNote(problems.join(" "));
  };

  const marks: number[] = [];
  const every = length <= 12 ? 1 : length <= 60 ? 5 : length <= 300 ? 30 : 60;
  for (let t = 0; t <= length + 0.001; t += every) marks.push(t);

  const draggedMark = useRef(false);

  const dragMark = (e: React.PointerEvent, el: El, t: number) => {
    e.stopPropagation();
    select([el.id]);
    const from = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const by = (ev.clientX - from) / pps;
      if (Math.abs(ev.clientX - from) < 2 && !moved) return;
      moved = true;
      draggedMark.current = true;
      dragPreview("move_key", { id: el.id, from: t, to: t + by });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        dragCommit("Move a moment");
      } else {
        seek(t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderBar = (el: El) => {
    const span = spanOf(el, frame);
    const keyTimes = [...new Set(MOVING.flatMap((p) => (el.keys[p] ?? []).map((k) => k.t)))];
    const isSelected = selection.includes(el.id);
    return (
      <div
        key={el.id}
        className={`time-span ${el.type} ${isSelected ? "on" : ""}`}
        data-name={`span-${el.name}`}
        style={{ left: span.start * pps, width: Math.max(4, (span.end - span.start) * pps) }}
        onPointerDown={(e) => drag(e, el, "all")}
      >
        {look === "cut" && <span className="time-span-name">{el.name}</span>}
        <b className="l" onPointerDown={(e) => drag(e, el, "start")} />
        {keyTimes.map((t) => (
          <u
            key={t}
            data-name="mark"
            title={clockText(t)}
            style={{ left: (t - span.start) * pps, cursor: "ew-resize" }}
            onPointerDown={(e) => dragMark(e, el, t)}
            onClick={(e) => {
              e.stopPropagation();
              if (draggedMark.current) {
                draggedMark.current = false;
                return;
              }
              seek(t);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              dispatch("remove_key", { ids: [el.id], t });
            }}
          />
        ))}
        <b className="r" onPointerDown={(e) => drag(e, el, "end")} />
      </div>
    );
  };

  return (
    <section className={`time ${look === "cut" ? "cut" : ""}`} data-name="time-strip">
      <div className="time-bar">
        <button className="pill" data-name="play" onClick={togglePlay} title={clock.playing ? "Pause" : "Play"}>
          {clock.playing ? "Pause" : "Play"}
        </button>
        <span className="time-now" data-name="time-now">
          {clockText(clock.t)} / {clockText(length)}
        </span>
        <label title="How long this frame plays, in seconds">
          Length
          <input
            key={length}
            data-name="length"
            type="number"
            min={0}
            step={0.5}
            defaultValue={Math.round(length * 10) / 10}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n) && n !== Math.round(length * 10) / 10) dispatch("set_duration", { id: frame.id, seconds: n });
            }}
          />
        </label>
        <div className="pill time-look">
          <button
            className={look === "layers" ? "active" : ""}
            data-name="look-layers"
            onClick={() => setLayout({ timeLook: "layers" })}
          >
            Layers
          </button>
          <button
            className={look === "cut" ? "active" : ""}
            data-name="look-cut"
            onClick={() => setLayout({ timeLook: "cut" })}
          >
            Cut
          </button>
        </div>
        <button className="pill" data-name="add-clip" onClick={bring} title="Bring video files into this frame, at the moment the clock is on">
          Add clip
        </button>
        {picked && (
          <>
            <b className="time-picked" title="What is selected">
              {picked.name}
            </b>
            <label title="How it arrives when it appears">
              Arrives
              <select data-name="arrives" value={entranceOf(picked, frame, "in")} onChange={(e) => dispatch("set_entrance", { ids: [picked.id], when: "in", kind: e.target.value as Entrance })}>
                {ENTRANCES.map((k) => (
                  <option key={k} value={k}>
                    {ENTRANCE_NAMES[k]}
                  </option>
                ))}
              </select>
            </label>
            <label title="How it goes when it leaves">
              Leaves
              <select data-name="leaves" value={entranceOf(picked, frame, "out")} onChange={(e) => dispatch("set_entrance", { ids: [picked.id], when: "out", kind: e.target.value as Entrance })}>
                {ENTRANCES.map((k) => (
                  <option key={k} value={k}>
                    {ENTRANCE_NAMES[k]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <span className="spacer" />
        <div className="time-zoom">
          <button
            className="time-quiet-btn"
            data-name="zoom-out"
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
            title="Zoom out (-)"
          >
            -
          </button>
          <button
            className="time-quiet-btn"
            data-name="zoom-fit"
            onClick={() => {
              setZoom(1);
              if (lanes.current) lanes.current.scrollLeft = 0;
            }}
            title="Fit to window (\)"
          >
            Fit
          </button>
          <button
            className="time-quiet-btn"
            data-name="zoom-in"
            onClick={() => setZoom((z) => z * 1.5)}
            title="Zoom in (=)"
          >
            +
          </button>
        </div>
        {note && <span className="time-note">{note}</span>}
        {making === null ? (
          <button className="pill primary" data-name="export-video" onClick={make} title="Make one video file out of this frame">
            Export video
          </button>
        ) : (
          <button className="pill" data-name="stop-export" onClick={stopExport} title="Stop making the video">
            Making your video, {Math.round(making * 100)}%. Stop
          </button>
        )}
      </div>

      <div className="time-lanes" ref={lanes}>
        <div className="time-row ruler">
          <span className="time-name" />
          <div className="time-lane" onPointerDown={scrub} style={{ width: laneWidth }}>
            {marks.map((t) => (
              <i key={t} style={{ left: t * pps }}>
                {clockText(t).replace(/\.0$/, "")}
              </i>
            ))}
          </div>
        </div>
        {displayRows.map((row) => (
          <div key={row.key} className={`time-row ${row.items.some((el) => selection.includes(el.id)) ? "on" : ""}`}>
            <span className="time-name" onClick={row.onClick} title={row.name}>
              {row.name}
            </span>
            <div className="time-lane" style={{ width: laneWidth }} onPointerDown={scrub}>
              {row.items.map(renderBar)}
            </div>
          </div>
        ))}
        <div className="time-head" style={{ left: NAMES + clock.t * pps }} />
      </div>
    </section>
  );
}
