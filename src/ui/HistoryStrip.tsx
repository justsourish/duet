import { useEffect, useRef, useState } from "react";
import { saveVersion } from "../project/project";
import { goTo, redo, restoreDoc, undo, useStore } from "../state/store";

const STEP = 30;
const LANE_Y = { you: 16, ai: 46 };
const PAD = 16;

const timeText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function HistoryStrip() {
  const timeline = useStore((s) => s.timeline);
  const cursor = useStore((s) => s.cursor);
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // The tooltip is drawn outside the scrolling strip, so it is never clipped.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Cmd or Ctrl + Shift + S opens the versions list, ready to type a name
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("duet:versions", show);
    return () => window.removeEventListener("duet:versions", show);
  }, []);

  // keep the current step in view
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = PAD + cursor * STEP;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [cursor, timeline.length]);

  const width = PAD * 2 + Math.max(0, timeline.length - 1) * STEP;
  const x = (i: number) => PAD + i * STEP;
  const y = (i: number) => LANE_Y[timeline[i].actor];
  const versions = timeline.map((e, i) => ({ e, i })).filter(({ e }) => e.version).reverse();

  const submit = async () => {
    const result = await saveVersion(name);
    setNote(result);
    if (!result) setName("");
  };

  return (
    <footer className="hist">
      <div className="lane-names">
        <span>You</span>
        <span className="ai">Duet</span>
      </div>

      <div className="scroller" ref={scroller}>
        <div className="lanes" style={{ width }}>
          <svg width={width} height={62} className="links">
            <line x1={0} x2={width} y1={LANE_Y.you} y2={LANE_Y.you} className="guide" />
            <line x1={0} x2={width} y1={LANE_Y.ai} y2={LANE_Y.ai} className="guide" />
            {timeline.slice(1).map((e, k) => {
              const i = k + 1;
              return <line key={i} x1={x(i - 1)} y1={y(i - 1)} x2={x(i)} y2={y(i)} className={`link ${e.actor === "ai" ? "ai" : ""}`} />;
            })}
          </svg>
          {timeline.map((e, i) => (
            <button
              key={i}
              className={`pt ${e.actor === "ai" ? "ai" : ""} ${i === cursor ? "now" : ""} ${i > cursor ? "future" : ""} ${e.version ? "ver" : ""}`}
              style={{ left: x(i), top: y(i) }}
              onMouseEnter={(ev) => {
                const r = ev.currentTarget.getBoundingClientRect();
                setTip({
                  text: `${e.version ? `Version: ${e.version}. ` : ""}${e.label} · ${e.actor === "ai" ? "Duet" : "You"} · ${timeText(e.time)}`,
                  x: r.left + r.width / 2,
                  y: r.top,
                });
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => goTo(i)}
              aria-label={e.label}
            />
          ))}
        </div>
      </div>

      <div className="hist-actions">
        <button className="mini" disabled={cursor === 0} onClick={undo} title="Undo (Ctrl or Cmd Z)">
          Undo
        </button>
        <button className="mini" disabled={cursor >= timeline.length - 1} onClick={redo} title="Redo (Shift Ctrl or Cmd Z)">
          Redo
        </button>
        <button className={`mini ${open ? "on" : ""}`} onClick={() => setOpen(!open)}>
          Versions{versions.length ? ` (${versions.length})` : ""}
        </button>
      </div>

      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y - 10 }}>
          {tip.text}
        </div>
      )}

      {open && (
        <div className="popover">
          <div className="pop-title">Save a version</div>
          <div className="pop-row">
            <input
              autoFocus
              value={name}
              placeholder="Name it, like Client round 1"
              onChange={(e) => {
                setName(e.target.value);
                setNote(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") submit();
              }}
            />
            <button className="mini primary" onClick={submit}>
              Save
            </button>
          </div>
          {note && <div className="pop-note">{note}</div>}
          <div className="pop-title">Your versions</div>
          {versions.length === 0 && <div className="pop-empty">None yet. A version is a moment you want to come back to.</div>}
          {versions.map(({ e, i }) => (
            <div className="pop-version" key={i}>
              <div>
                <div className="v-name">{e.version}</div>
                <div className="v-time">{new Date(e.time).toLocaleString()}</div>
              </div>
              <button
                className="mini"
                onClick={() => {
                  restoreDoc(e.doc, `Went back to version "${e.version}"`);
                  setOpen(false);
                }}
              >
                Go back
              </button>
            </div>
          ))}
        </div>
      )}
    </footer>
  );
}
