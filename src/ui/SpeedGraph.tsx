import { useRef, useState } from "react";
import { dispatch, dragCommit, dragPreview } from "../state/store";
import type { El, Moving } from "../document/types";
import { CURVES } from "../document/time";
import type { CurveName } from "../document/time";

/** How a move speeds up and slows down, drawn as a curve the designer can pick or bend. */

type Curve = [number, number, number, number];

const READY: [CurveName, string][] = [
  ["steady", "Steady"],
  ["gentle", "Gentle"],
  ["snappy", "Snappy"],
  ["bouncy", "Bouncy"],
];

/** What the older names look like as a curve, so a move made before shaping existed still draws. */
const NAMED: Record<string, Curve> = {
  linear: [0, 0, 1, 1],
  "in-out": [0.65, 0, 0.35, 1],
  in: [0.55, 0, 1, 0.45],
  out: [0, 0.55, 0.45, 1],
};

const W = 168;
const H = 124;
const PAD = 18;
/** The graph shows from a little below the start to a little above the end, so an overshoot can be seen. */
const LOW = -0.15;
const HIGH = 1.45;

const px = (x: number) => PAD + x * (W - PAD * 2);
const py = (y: number) => H - PAD - ((y - LOW) / (HIGH - LOW)) * (H - PAD * 2);

const same = (a: Curve, b: readonly number[]) => a.every((n, i) => Math.abs(n - b[i]) < 0.005);

export default function SpeedGraph({ el, props, times }: { el: El; props: Moving[]; times: number[] }) {
  // the move that ends at one of these moments; the first moment has no move arriving at it
  const arrivals = times.slice(1);
  const [at, setAt] = useState(0);
  const t = arrivals[Math.min(at, arrivals.length - 1)];
  const key = el.keys[props.find((p) => el.keys[p]?.some((k) => Math.abs(k.t - t) < 0.005)) ?? props[0]]?.find((k) => Math.abs(k.t - t) < 0.005);
  const curve: Curve = key?.curve ?? NAMED[key?.ease ?? "in-out"] ?? NAMED["in-out"];
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const args = (shape: Curve | CurveName) => ({ ids: [el.id], props, t, shape });

  const move = (e: React.PointerEvent, which: 0 | 1) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const sx = ((e.clientX - box.left) / box.width) * W;
    const sy = ((e.clientY - box.top) / box.height) * H;
    const x = Math.min(1, Math.max(0, (sx - PAD) / (W - PAD * 2)));
    const y = Math.min(HIGH, Math.max(LOW, LOW + ((H - PAD - sy) / (H - PAD * 2)) * (HIGH - LOW)));
    const next: Curve = which === 0 ? [x, y, curve[2], curve[3]] : [curve[0], curve[1], x, y];
    dragPreview("set_curve", args(next));
  };

  const handle = (which: 0 | 1) => {
    const hx = px(curve[which * 2]);
    const hy = py(curve[which * 2 + 1]);
    return (
      <g key={which}>
        <line className="sg-arm" x1={px(which)} y1={py(which)} x2={hx} y2={hy} />
        <circle
          className={`sg-handle${drag === which ? " on" : ""}`}
          cx={hx}
          cy={hy}
          r={6}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(which);
          }}
          onPointerMove={(e) => drag === which && move(e, which)}
          onPointerUp={() => {
            if (drag === which) dragCommit("Change how a move speeds up and slows down");
            setDrag(null);
          }}
        />
      </g>
    );
  };

  return (
    <div className="speed">
      {arrivals.length > 1 && (
        <label className="f">
          <span>Move</span>
          <select value={Math.min(at, arrivals.length - 1)} onChange={(e) => setAt(Number(e.target.value))}>
            {arrivals.map((end, i) => (
              <option key={end} value={i}>
                {Math.round(times[i] * 100) / 100}s to {Math.round(end * 100) / 100}s
              </option>
            ))}
          </select>
        </label>
      )}
      <svg ref={svg} className="sg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="How fast the move is, over its time">
        <rect className="sg-box" x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} />
        <line className="sg-line" x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />
        <path className="sg-curve" d={`M ${px(0)} ${py(0)} C ${px(curve[0])} ${py(curve[1])} ${px(curve[2])} ${py(curve[3])} ${px(1)} ${py(1)}`} />
        {handle(0)}
        {handle(1)}
        <text className="sg-label" x={px(0)} y={py(0) + 12}>
          time
        </text>
        <text className="sg-label" x={2} y={py(1) + 3}>
          how far
        </text>
      </svg>
      <div className="speed-ready">
        {READY.map(([name, label]) => (
          <button key={name} type="button" className={`mini${same(curve, CURVES[name]) ? " on" : ""}`} onClick={() => dispatch("set_curve", args(name))}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
