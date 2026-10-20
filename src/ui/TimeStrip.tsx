import { Fragment, useEffect, useRef, useState } from "react";
import { runCommand } from "../commands";
import { KEY_GROUPS, spanOf } from "../document/time";
import { MOVING, playsFile } from "../document/types";
import type { Doc, El, Moving } from "../document/types";
import { currentDoc, dispatch, dragBase, dragCancel, dragCommit, dragPreview, dragPreviewDoc, select, useStore } from "../state/store";
import { clipLength } from "../video/clips";
import { cutNow } from "../video/edit";
import { openScene, pause, play, seek, togglePlay } from "../video/play";
import Icon from "./Icons";
import { setKeyFocus } from "./keyFocus";
import { QUALITIES, SIZES, addMedia, defaultChoice, exportScene, exportSize, stopExport } from "../video/scene";
import type { ExportChoice } from "../video/scene";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { TIME_MIN_H, setLayout, useLayout } from "./layout";
import { useDismiss } from "./useDismiss";

/** Time under the canvas: a row for each thing in a frame that plays, when it shows, and where the clock is. */

const NAMES = 150;
const SHORTEST = 0.1;

/** A keyframe picked in the timeline: Delete takes it away. Without props it is every change at that moment. */
interface Picked {
  id: string;
  t: number;
  props?: Moving[];
}

const clockText = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** The frame on the page that holds this thing. */
function pageFrame(doc: Doc, id: string | undefined): El | null {
  let el = id ? doc.elements[id] : undefined;
  while (el?.parentId) el = doc.elements[el.parentId];
  return el?.type === "frame" ? el : null;
}

export default function TimeStrip() {
  const mode = useLayout((d) => d.mode);
  const look = useLayout((d) => d.timeLook ?? "layers");
  const keysOpen = useLayout((d) => d.keysOpen);
  const gradeEvery = useLayout((d) => d.gradeEvery);
  const timeH = useLayout((d) => d.timeH ?? 170);
  const [growing, setGrowing] = useState<number | null>(null);
  const doc = useStore((s) => currentDoc(s));
  const selection = useStore((s) => s.selection);
  const clock = useStore((s) => s.clock);
  const lanes = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [making, setMaking] = useState<number | null>(null);
  const [note, setNote] = useState("");
  // how the video is made, chosen before it is made, and where the last one went
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<ExportChoice>(defaultChoice);
  const [made, setMade] = useState<string | null>(null);
  // set while a keyframe mark is being dragged, so letting go is not taken for a click
  const draggedMark = useRef(false);
  const [snap, setSnap] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; el: El; mark?: Picked } | null>(null);
  useDismiss(!!menu, () => setMenu(null), ".ctx");
  const [picked, setPicked] = useState<Picked | null>(null);
  // a layer opened or folded by its arrow; Option U opens or folds them all again
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  useEffect(() => setFolds({}), [keysOpen]);
  useEffect(() => {
    if (picked && !selection.includes(picked.id)) setPicked(null);
  }, [picked, selection]);

  // Delete takes away the keyframe picked, and not the thing it belongs to
  useEffect(() => {
    if (!picked) return;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable)) return;
      if (e.key === "Escape") return setPicked(null);
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dispatch("remove_key", { ids: [picked.id], props: picked.props, t: picked.t });
      setPicked(null);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [picked]);

  // what is selected decides which frame is open, and with nothing selected the open one stays
  const frame = pageFrame(doc, selection[0]) ?? (clock.scene ? (doc.elements[clock.scene] ?? null) : null);
  const plays = !!frame && frame.duration > 0;
  const sceneId = mode !== "design" && plays ? frame.id : null;
  useEffect(() => openScene(sceneId), [sceneId]);

  // the room the timeline has is the panel's own width, measured on the panel so it never depends on what is inside it
  useEffect(() => {
    const el = lanes.current?.parentElement;
    if (!el) return;
    const measure = () => setWide(Math.max(100, el.clientWidth - NAMES - 16));
    measure();
    const see = new ResizeObserver(measure);
    see.observe(el);
    return () => see.disconnect();
  }, [plays, mode, sceneId]);

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
      if (!["s", "d", "q", "w", "k", "l", " "].includes(k)) return;
      e.preventDefault();
      e.stopPropagation();
      // the canvas listens on the window too, and must not take the spacebar for the hand tool
      e.stopImmediatePropagation();
      // the spacebar plays and stops, as in every video editor. The hand tool still moves the canvas.
      if (k === " ") return e.repeat ? undefined : togglePlay();
      if (k === "l") return play();
      if (k === "k") return pause();
      cutNow(k === "s" ? "split" : k === "d" ? "remove" : k === "q" ? "before" : "after");
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

  if (mode === "design") return null;
  if (!plays) {
    if (frame && selection.length === 1 && selection[0] === frame.id) {
      return (
        <section className="time still" onContextMenu={(e) => e.preventDefault()}>
          <button className="pill" data-name="make-video" onClick={() => dispatch("set_duration", { id: frame.id, seconds: 10 })} title="Give this frame a length, so what is in it can appear, move and leave">
            Make this frame a scene
          </button>
        </section>
      );
    }
    return (
      <section className="time still" onContextMenu={(e) => e.preventDefault()}>
        <span className="time-quiet">Select a frame to make it a scene.</span>
      </section>
    );
  }

  const things = frame.childIds.map((id) => doc.elements[id]).filter(Boolean).reverse();
  const nonVideos = things.filter((el) => !playsFile(el));
  const sounds = things.filter((el) => el.type === "sound");
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
          ...packTracks(sounds).map((items, i) => ({
            key: `sound-${i + 1}`,
            name: `Sound ${i + 1}`,
            items,
          })),
        ];


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

  const getSnapTargets = (excludeId?: string) => {
    if (!frame) return [];
    const ts = [0, length, clock.t];
    for (const id of frame.childIds) {
      if (id === excludeId) continue;
      const other = doc.elements[id];
      if (other) {
        const s = spanOf(other, frame);
        ts.push(s.start, s.end);
      }
    }
    return [...new Set(ts)];
  };

  const findSnap = (cand: number, targets: number[]) => {
    let bestTarget: number | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const dist = Math.abs((cand - t) * pps);
      if (dist <= 8 && dist < bestDist) {
        bestDist = dist;
        bestTarget = t;
      }
    }
    return bestTarget !== null ? { time: bestTarget, dist: bestDist } : null;
  };

  const drag = (e: React.PointerEvent, el: El, part: "all" | "start" | "end") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select([el.id]);
    const from = e.clientX;
    const span = spanOf(el, frame);
    const long = span.end - span.start;
    // a clip cannot show more than its file holds
    const file = playsFile(el) ? clipLength(el.src) : 0;
    const targets = getSnapTargets(el.id);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const by = (ev.clientX - from) / pps;
      if (Math.abs(ev.clientX - from) < 2 && !moved) return;
      moved = true;
      const noSnap = ev.metaKey || ev.ctrlKey;
      if (part === "all") {
        const rawStart = span.start + by;
        const rawEnd = rawStart + long;
        let start = rawStart;
        let snapTime: number | null = null;
        if (!noSnap) {
          const snapS = findSnap(rawStart, targets);
          const snapE = findSnap(rawEnd, targets);
          if (snapS && snapE) {
            if (snapS.dist <= snapE.dist) {
              start = snapS.time;
              snapTime = snapS.time;
            } else {
              start = snapE.time - long;
              snapTime = snapE.time;
            }
          } else if (snapS) {
            start = snapS.time;
            snapTime = snapS.time;
          } else if (snapE) {
            start = snapE.time - long;
            snapTime = snapE.time;
          }
        }
        start = Math.max(0, start);
        if (snapTime !== null) {
          const edgeHolding = Math.abs((start - snapTime) * pps) <= 0.5 || Math.abs((start + long - snapTime) * pps) <= 0.5;
          if (!edgeHolding) snapTime = null;
        }
        setSnap(snapTime);
        // dragged past the end, the frame grows to hold it
        const base = start + long > length ? runCommand(dragBase(), "set_duration", { id: frame.id, seconds: start + long }) : dragBase();
        dragPreviewDoc(runCommand(base, "set_timing", { ids: [el.id], start, end: start + long }));
      } else if (part === "start") {
        const least = playsFile(el) ? span.start - el.clipFrom : 0;
        const rawStart = span.start + by;
        let start = rawStart;
        let snapTime: number | null = null;
        if (!noSnap) {
          const s = findSnap(rawStart, targets);
          if (s) {
            start = s.time;
            snapTime = s.time;
          }
        }
        start = Math.max(0, least, Math.min(span.end - SHORTEST, start));
        if (snapTime !== null && Math.abs((start - snapTime) * pps) > 0.5) snapTime = null;
        setSnap(snapTime);
        dragPreview("set_timing", { ids: [el.id], start, end: span.end, ...(playsFile(el) ? { clipFrom: el.clipFrom + (start - span.start) } : {}) });
      } else {
        const most = file ? span.start + file - el.clipFrom : length;
        const rawEnd = span.end + by;
        let end = rawEnd;
        let snapTime: number | null = null;
        if (!noSnap) {
          const s = findSnap(rawEnd, targets);
          if (s) {
            end = s.time;
            snapTime = s.time;
          }
        }
        end = Math.max(span.start + SHORTEST, Math.min(length, most, end));
        if (snapTime !== null && Math.abs((end - snapTime) * pps) > 0.5) snapTime = null;
        setSnap(snapTime);
        dragPreview("set_timing", { ids: [el.id], start: span.start, end });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnap(null);
      if (moved) dragCommit("Change when it shows");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const make = async () => {
    setNote("");
    setMaking(0);
    try {
      setChoosing(false);
      setMade(null);
      const file = await exportScene(frame.id, setMaking, choice);
      if (file) {
        setMade(file);
        setNote(choice.ask ? `Saved ${file.split(/[\\/]/).pop()}` : "Saved in Documents, Duet, Exports");
      }
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    } finally {
      setMaking(null);
    }
  };

  const bring = async () => {
    setNote("");
    const problems = await addMedia(frame.id).catch((e) => [String(e)]);
    if (problems.length) setNote(problems.join(" "));
  };

  const marks: number[] = [];
  // marks far enough apart to read, whatever the length and the zoom
  const every = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((n) => n * pps >= 64) ?? 3600;
  for (let t = 0; t <= length + 0.001; t += every) marks.push(t);


  const dragMark = (e: React.PointerEvent, el: El, t: number, props?: Moving[]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select([el.id]);
    const from = e.clientX;
    const targets = getSnapTargets(el.id);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const by = (ev.clientX - from) / pps;
      if (Math.abs(ev.clientX - from) < 2 && !moved) return;
      moved = true;
      draggedMark.current = true;
      const noSnap = ev.metaKey || ev.ctrlKey;
      const rawT = t + by;
      let to = rawT;
      let snapTime: number | null = null;
      if (!noSnap) {
        const s = findSnap(rawT, targets);
        if (s) {
          to = s.time;
          snapTime = s.time;
        }
      }
      setSnap(snapTime);
      dragPreview("move_key", { id: el.id, from: t, to, props });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnap(null);
      if (moved) {
        dragCommit("Move a moment");
        setPicked(null);
      } else {
        setKeyFocus({ id: el.id, t });
        setPicked({ id: el.id, t, props });
        seek(t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const moves = (el: El) => MOVING.some((p) => (el.keys[p]?.length ?? 0) > 0);
  // Option U opens everything that moves; the arrow opens any layer, moving or not
  const opened = (el: El) => folds[el.id] ?? (keysOpen && moves(el));
  const isPicked = (el: El, t: number, props?: Moving[]) => picked?.id === el.id && picked.t === t && picked.props === props;
  const markMenu = (e: React.MouseEvent, el: El, t: number, props?: Moving[]) => {
    e.preventDefault();
    e.stopPropagation();
    select([el.id]);
    setPicked({ id: el.id, t, props });
    setMenu({ x: e.clientX, y: e.clientY, el, mark: { id: el.id, t, props } });
  };

  /** Pull the top edge of the timeline to give its rows more room or less. */
  const grow = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientY;
    const start = timeH;
    const at = (y: number) => Math.round(Math.max(TIME_MIN_H, Math.min(window.innerHeight * 0.7, start + from - y)));
    const move = (ev: PointerEvent) => setGrowing(at(ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGrowing(null);
      setLayout({ timeH: at(ev.clientY) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderBar = (el: El) => {
    const span = spanOf(el, frame);
    // in Cut the bars stay clean: a thing's marks are listed in the panel on the right
    const keyTimes = look === "cut" ? [] : [...new Set(MOVING.flatMap((p) => (el.keys[p] ?? []).map((k) => k.t)))];
    const isSelected = selection.includes(el.id);
    return (
      <div
        key={el.id}
        className={`time-span ${el.type} ${isSelected ? "on" : ""}`}
        data-name={`span-${el.name}`}
        style={{ left: span.start * pps, width: Math.max(4, (span.end - span.start) * pps) }}
        onPointerDown={(e) => drag(e, el, "all")}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          select([el.id]);
          setMenu({ x: e.clientX, y: e.clientY, el });
        }}
      >
        {look === "cut" && <span className="time-span-name">{el.name}</span>}
        <b className="l" onPointerDown={(e) => drag(e, el, "start")} />
        {keyTimes.map((t) => (
          <u
            key={t}
            className={isPicked(el, t) ? "picked" : ""}
            data-name="mark"
            title={`${clockText(t)}. Click to pick, Delete to remove`}
            onContextMenu={(e) => markMenu(e, el, t)}
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

  /** One row for each kind of change a thing has marks for: where its marks are, and nothing else. */
  const renderKindRows = (el: El) =>
    KEY_GROUPS.map((g) => {
      const times = [...new Set(g.props.flatMap((p) => (el.keys[p] ?? []).map((k) => k.t)))].sort((a, b) => a - b);
      const first = times[0] ?? 0;
      const last = times[times.length - 1] ?? 0;
      const now = Math.round(clock.t * 1000) / 1000;
      const here = times.some((k) => Math.abs(k - now) < 0.004);
      return (
        <div key={`${el.id}-${g.name}`} className={`time-row kind ${selection.includes(el.id) ? "on" : ""}`} data-name={`kind-${g.name}`}>
          <span className="time-name" onClick={() => select([el.id])} title={`${el.name}, ${g.name}`}>
            <button
              className={`time-key ${here ? "on" : ""}`}
              data-name={`key-${g.name}`}
              title={here ? `Take away the ${g.name.toLowerCase()} keyframe at the playhead` : `Add ${/^[aeiou]/i.test(g.name) ? "an" : "a"} ${g.name.toLowerCase()} keyframe at the playhead`}
              onClick={(e) => {
                e.stopPropagation();
                select([el.id]);
                dispatch(here ? "remove_key" : "key_now", { ids: [el.id], props: g.props, t: now });
              }}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1 11 6 6 11 1 6Z" fill={here ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </button>
            {g.name}
          </span>
          <div className="time-lane" style={{ width: laneWidth }} onPointerDown={scrub}>
            <div className="time-kindspan" style={{ left: first * pps, width: Math.max(0, (last - first) * pps) }} />
            {times.map((t) => (
              <u
                key={t}
                className={`kind-mark ${isPicked(el, t, g.props) ? "picked" : ""}`}
                data-name="mark"
                title={`${g.name}, ${clockText(t)}. Click to pick, Delete to remove`}
                onContextMenu={(e) => markMenu(e, el, t, g.props)}
                style={{ left: t * pps, cursor: "ew-resize" }}
                onPointerDown={(e) => dragMark(e, el, t, g.props)}
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
                  dispatch("remove_key", { ids: [el.id], props: g.props, t });
                }}
              />
            ))}
          </div>
        </div>
      );
    });

  return (
    <section className={`time ${look === "cut" ? "cut" : ""}`} data-name="time-strip" onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
      <div className="time-bar">
        <button className="pill" data-name="play" onClick={togglePlay} title={clock.playing ? "Pause" : "Play"}>
          {clock.playing ? "Pause" : "Play"}
        </button>
        <span className="time-now" data-name="time-now">
          {clockText(clock.t)} / {clockText(length)}
        </span>
        <label title="How long this frame plays, in seconds">
          <span
            className="time-label"
            onPointerDown={(e) => {
              if (e.button !== 0 || !frame) return;
              e.preventDefault();
              const target = e.currentTarget;
              target.setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const startVal = length;
              let hasDragged = false;
              let currentVal = startVal;

              const onMove = (ev: PointerEvent) => {
                if (ev.pointerId !== e.pointerId) return;
                const dx = ev.clientX - startX;
                if (!hasDragged) {
                  if (Math.abs(dx) < 3) return;
                  hasDragged = true;
                }
                ev.preventDefault();
                const mult = ev.shiftKey ? 1.0 : 0.1;
                const next = Math.max(0, Math.round((startVal + dx * mult) * 10) / 10);
                currentVal = next;
                dragPreview("set_duration", { id: frame.id, seconds: next });
              };

              const onUp = (ev: PointerEvent) => {
                if (ev.pointerId !== e.pointerId) return;
                target.removeEventListener("pointermove", onMove);
                target.removeEventListener("pointerup", onUp);
                target.removeEventListener("pointercancel", onCancel);
                try {
                  target.releasePointerCapture(ev.pointerId);
                } catch {}
                if (hasDragged) {
                  dragCancel();
                  if (currentVal !== startVal) {
                    dispatch("set_duration", { id: frame.id, seconds: currentVal });
                  }
                }
              };

              const onCancel = (ev: PointerEvent) => {
                if (ev.pointerId !== e.pointerId) return;
                target.removeEventListener("pointermove", onMove);
                target.removeEventListener("pointerup", onUp);
                target.removeEventListener("pointercancel", onCancel);
                try {
                  target.releasePointerCapture(ev.pointerId);
                } catch {}
                if (hasDragged) {
                  dragCancel();
                }
              };

              target.addEventListener("pointermove", onMove);
              target.addEventListener("pointerup", onUp);
              target.addEventListener("pointercancel", onCancel);
            }}
          >
            Length
          </span>
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
          <span className="time-unit">s</span>
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
        <button className="pill" data-name="add-media" onClick={() => void bring()} title="Bring in video, music or a voice, at the moment the clock is on">
          Add
        </button>
        {mode === "color" && (
          <div className="pill time-look grade-every" title="Where a colour change goes">
            <button className={gradeEvery ? "" : "active"} data-name="grade-this" onClick={() => setLayout({ gradeEvery: false })} title="Change only the picked clips">
              This clip
            </button>
            <button className={gradeEvery ? "active" : ""} data-name="grade-every" onClick={() => setLayout({ gradeEvery: true })} title="Change every clip in this scene at once">
              Every clip
            </button>
          </div>
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
        {made && making === null && (
          <button className="pill" data-name="show-video" onClick={() => void revealItemInDir(made)} title="Show the video in Finder">
            Show
          </button>
        )}
        {making === null ? (
          <div className="export-anchor">
            <button className="pill primary" data-name="export-video" onClick={() => setChoosing(!choosing)} title="Make one video file out of this scene">
              Export video
            </button>
            {choosing && (
              <div className="export-pop" data-name="export-settings">
                <label>
                  Size
                  <select data-name="export-size" value={choice.longSide} onChange={(e) => setChoice({ ...choice, longSide: Number(e.target.value) })}>
                    {SIZES.map((z) => {
                      const [w, h] = exportSize(frame, z.longSide);
                      return (
                        <option key={z.longSide} value={z.longSide}>
                          {z.name}, {w} by {h}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Frames a second
                  <select data-name="export-fps" value={choice.fps} onChange={(e) => setChoice({ ...choice, fps: Number(e.target.value) })}>
                    {[24, 25, 30, 60].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Kind
                  <select data-name="export-kind" value={choice.master ? "master" : "share"} onChange={(e) => setChoice({ ...choice, master: e.target.value === "master" })}>
                    <option value="share">MP4, to share</option>
                    <option value="master">ProRes, to keep editing</option>
                  </select>
                </label>
                {!choice.master && (
                  <label>
                    Quality
                    <select data-name="export-quality" value={choice.quality} onChange={(e) => setChoice({ ...choice, quality: Number(e.target.value) })}>
                      {QUALITIES.map((q) => (
                        <option key={q.quality} value={q.quality}>
                          {q.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="export-where">
                  <input type="checkbox" checked={choice.ask} onChange={(e) => setChoice({ ...choice, ask: e.target.checked })} />
                  Ask me where to save
                </label>
                {!choice.ask && <div className="time-quiet">It goes to Documents, Duet, Exports.</div>}
                <button className="pill primary" data-name="export-go" onClick={make}>
                  Export
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="pill" data-name="stop-export" onClick={stopExport} title="Stop making the video">
            Making your video, {Math.round(making * 100)}%. Stop
          </button>
        )}
      </div>

      <div className="time-grip" data-name="timeline-height" onPointerDown={grow} title="Pull to make the timeline taller or shorter" />
      <div className="time-lanes" ref={lanes} style={{ height: growing ?? timeH, maxHeight: "none" }}>
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
          <Fragment key={row.key}>
            <div className={`time-row ${row.items.some((el) => selection.includes(el.id)) ? "on" : ""} ${row.items.every((el) => el.hidden) ? "is-hidden" : ""}`}>
              <span className="time-name" onClick={row.onClick} title={row.name}>
                {row.items.length === 1 && (
                  <button
                    className={`time-eye ${row.items[0].hidden ? "off" : ""}`}
                    data-name={`eye-${row.name}`}
                    title={row.items[0].hidden ? "Show" : "Hide, so it is not drawn or exported"}
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = row.items[0];
                      dispatch("set_props", { ids: [el.id], props: { hidden: !el.hidden }, label: el.hidden ? "Show" : "Hide" });
                    }}
                  >
                    <Icon name={row.items[0].hidden ? "eye-off" : "eye"} size={12} />
                  </button>
                )}
                {look === "layers" && (
                  <span className="time-fold-room">
                    {row.items.length === 1 && (
                      <button
                        className={`time-fold ${opened(row.items[0]) ? "open" : ""}`}
                        data-name={`keys-${row.name}`}
                        title={opened(row.items[0]) ? "Hide its keyframes" : "Show its keyframes"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = row.items[0];
                          setFolds((f) => ({ ...f, [el.id]: !opened(el) }));
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                          <path d="M2.5 1.5 5.5 4 2.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
                {row.name}
              </span>
              <div className="time-lane" style={{ width: laneWidth }} onPointerDown={scrub}>
                {row.items.map(renderBar)}
              </div>
            </div>
            {look === "layers" && row.items.filter(opened).map((el) => renderKindRows(el))}
          </Fragment>
        ))}
        <div className="time-head" style={{ left: NAMES + clock.t * pps }} />
        {snap !== null && <div className="time-snap" style={{ left: NAMES + snap * pps }} />}
      </div>
      {menu && (
        <div
          className="ctx"
          style={{
            left: Math.max(10, Math.min(menu.x, window.innerWidth - 230)),
            top: Math.max(10, Math.min(menu.y, window.innerHeight - 270)),
          }}
        >
          {menu.mark && (
            <>
              <div
                className="ctx-item"
                data-name="remove-this-mark"
                onClick={() => {
                  const m = menu.mark!;
                  setMenu(null);
                  setPicked(null);
                  dispatch("remove_key", { ids: [m.id], props: m.props, t: m.t });
                }}
              >
                <span>Remove this mark</span>
                <kbd>Delete</kbd>
              </div>
              <div className="ctx-line" />
            </>
          )}
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              if (sceneId) dispatch("split_at", { sceneId, t: clock.t, ids: [el.id] });
            }}
          >
            <span>Cut here</span>
            <kbd>S</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("ripple_delete", { ids: [el.id] });
            }}
          >
            <span>Delete and close the gap</span>
            <kbd>D</kbd>
          </div>
          <div className="ctx-line" />
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["x", "y"], t: clock.t });
            }}
          >
            <span>Mark position</span>
            <kbd>Option P</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["width", "height"], t: clock.t });
            }}
          >
            <span>Mark size</span>
            <kbd>Option S</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["opacity"], t: clock.t });
            }}
          >
            <span>Mark opacity</span>
            <kbd>Option T</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["rotation"], t: clock.t });
            }}
          >
            <span>Mark turn</span>
            <kbd>Option R</kbd>
          </div>
          <div className="ctx-line" />
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("remove_key", { ids: [el.id] });
            }}
          >
            <span>Remove every mark</span>
          </div>
        </div>
      )}
    </section>
  );
}
