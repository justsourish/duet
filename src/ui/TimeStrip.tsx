import { useEffect, useRef, useState } from "react";
import { ENTRANCES, spanOf } from "../document/time";
import type { Entrance } from "../document/time";
import { MOVING } from "../document/types";
import type { Doc, El } from "../document/types";
import { currentDoc, dispatch, dragCommit, dragPreview, select, useStore } from "../state/store";
import { clipLength } from "../video/clips";
import { openScene, pause, seek, togglePlay } from "../video/play";
import { addClips, exportScene, stopExport } from "../video/scene";
import { useLayout } from "./layout";

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
  const doc = useStore((s) => currentDoc(s));
  const selection = useStore((s) => s.selection);
  const clock = useStore((s) => s.clock);
  const lanes = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(600);
  const [making, setMaking] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const frame = pageFrame(doc, selection[0]);
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

  if (mode !== "motion") return null;
  if (!plays) {
    if (frame && selection.length === 1 && selection[0] === frame.id) {
      return (
        <section className="time still">
          <button className="pill" data-name="make-video" onClick={() => dispatch("set_duration", { id: frame.id, seconds: 10 })} title="Give this frame a length, so what is in it can appear, move and leave">
            Make this frame a video
          </button>
        </section>
      );
    }
    return (
      <section className="time still">
        <span className="time-quiet">Select a frame to give it a length.</span>
      </section>
    );
  }

  const length = frame.duration;
  const pps = wide / length;
  const rows = frame.childIds.map((id) => doc.elements[id]).filter(Boolean).reverse();
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
        const start = Math.max(0, Math.min(length - long, span.start + by));
        dragPreview("set_timing", { ids: [el.id], start, end: start + long });
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

  return (
    <section className="time" data-name="time-strip">
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
            defaultValue={length}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n) && n !== length) dispatch("set_duration", { id: frame.id, seconds: n });
            }}
          />
        </label>
        <button className="pill" data-name="add-clip" onClick={bring} title="Bring video files into this frame, at the moment the clock is on">
          Add clip
        </button>
        {picked && (
          <>
            <label title="How it arrives when it appears">
              Arrives
              <select data-name="arrives" value="" onChange={(e) => e.target.value && dispatch("set_entrance", { ids: [picked.id], when: "in", kind: e.target.value as Entrance })}>
                <option value="">Choose</option>
                {ENTRANCES.map((k) => (
                  <option key={k} value={k}>
                    {ENTRANCE_NAMES[k]}
                  </option>
                ))}
              </select>
            </label>
            <label title="How it goes when it leaves">
              Leaves
              <select data-name="leaves" value="" onChange={(e) => e.target.value && dispatch("set_entrance", { ids: [picked.id], when: "out", kind: e.target.value as Entrance })}>
                <option value="">Choose</option>
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
          <div className="time-lane" onPointerDown={scrub} style={{ width: wide }}>
            {marks.map((t) => (
              <i key={t} style={{ left: t * pps }}>
                {clockText(t).replace(/\.0$/, "")}
              </i>
            ))}
          </div>
        </div>
        {rows.map((el) => {
          const span = spanOf(el, frame);
          const keyTimes = [...new Set(MOVING.flatMap((p) => (el.keys[p] ?? []).map((k) => k.t)))];
          return (
            <div key={el.id} className={`time-row ${selection.includes(el.id) ? "on" : ""}`}>
              <span className="time-name" onClick={() => select([el.id])} title={el.name}>
                {el.name}
              </span>
              <div className="time-lane" style={{ width: wide }} onPointerDown={scrub}>
                <div className={`time-span ${el.type}`} data-name={`span-${el.name}`} style={{ left: span.start * pps, width: Math.max(4, (span.end - span.start) * pps) }} onPointerDown={(e) => drag(e, el, "all")}>
                  <b className="l" onPointerDown={(e) => drag(e, el, "start")} />
                  {keyTimes.map((t) => (
                    <u key={t} style={{ left: (t - span.start) * pps }} />
                  ))}
                  <b className="r" onPointerDown={(e) => drag(e, el, "end")} />
                </div>
              </div>
            </div>
          );
        })}
        <div className="time-head" style={{ left: NAMES + clock.t * pps }} />
      </div>
    </section>
  );
}
