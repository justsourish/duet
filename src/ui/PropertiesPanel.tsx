import { useEffect, useState } from "react";
import { currentDoc, dispatch, useStore } from "../state/store";
import type { El } from "../document/types";
import { measureText } from "../canvas/text";

function NumField({ label, value, onCommit, min }: { label: string; value: number | ""; onCommit: (n: number) => void; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && n !== value) onCommit(min !== undefined ? Math.max(min, n) : n);
    else setText(String(value));
  };
  return (
    <label className="f">
      <span>{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ColorField({ value, onCommit, none }: { value: string | null; onCommit: (c: string | null) => void; none?: boolean }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const valid = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
  return (
    <div className="f color">
      <input
        type="color"
        value={value && valid(value) && value.length === 7 ? value : "#000000"}
        onChange={(e) => onCommit(e.target.value)}
      />
      <input
        value={text}
        placeholder={none ? "None" : ""}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === "" && none) onCommit(null);
          else if (valid(text)) onCommit(text);
          else setText(value ?? "");
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

export default function PropertiesPanel() {
  const selection = useStore((s) => s.selection);
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const doc = currentDoc();
  const els = selection.map((id) => doc.elements[id]).filter(Boolean) as El[];

  if (els.length === 0) {
    return (
      <aside className="right">
        <div className="panel-title">Design</div>
        <div className="empty pad">Select something to change it.</div>
      </aside>
    );
  }

  const ids = els.map((e) => e.id);
  const one = els.length === 1 ? els[0] : null;
  const set = (props: Partial<El>, label?: string) => dispatch("set_props", { ids, props, label });
  const first = els[0];
  const allText = els.every((e) => e.type === "text");
  const hasRadius = els.every((e) => e.type === "frame" || e.type === "rect");

  return (
    <aside className="right">
      <div className="panel-title">{one ? one.name : `${els.length} selected`}</div>

      {one && (
        <div className="sec">
          <h4>Position and size</h4>
          <div className="field">
            <NumField label="X" value={Math.round(one.x * 100) / 100} onCommit={(n) => dispatch("move_elements", { ids, dx: n - one.x, dy: 0 })} />
            <NumField label="Y" value={Math.round(one.y * 100) / 100} onCommit={(n) => dispatch("move_elements", { ids, dx: 0, dy: n - one.y })} />
            <NumField
              label="W"
              value={Math.round(one.width * 100) / 100}
              min={1}
              onCommit={(n) => dispatch("resize_element", { id: one.id, x: one.x, y: one.y, width: n, height: one.height })}
            />
            <NumField
              label="H"
              value={Math.round(one.height * 100) / 100}
              min={1}
              onCommit={(n) => dispatch("resize_element", { id: one.id, x: one.x, y: one.y, width: one.width, height: n })}
            />
          </div>
        </div>
      )}

      {hasRadius && (
        <div className="sec">
          <h4>Corners</h4>
          <NumField label="Radius" value={first.radius} min={0} onCommit={(n) => set({ radius: n }, "Change corner radius")} />
        </div>
      )}

      <div className="sec">
        <h4>{allText ? "Text colour" : "Fill"}</h4>
        <ColorField value={first.fill} onCommit={(c) => c && set({ fill: c }, "Change fill")} />
      </div>

      {!allText && (
        <div className="sec">
          <h4>Stroke</h4>
          <ColorField none value={first.stroke} onCommit={(c) => set({ stroke: c }, "Change stroke")} />
          <div className="gap" />
          <NumField label="Width" value={first.strokeWidth} min={0} onCommit={(n) => set({ strokeWidth: n }, "Change stroke width")} />
        </div>
      )}

      {allText && (
        <div className="sec">
          <h4>Text</h4>
          <NumField
            label="Size"
            value={first.fontSize}
            min={1}
            onCommit={(n) => {
              if (one) {
                const m = measureText(one.text, n);
                set({ fontSize: n, width: m.width + 2, height: m.height }, "Change font size");
              } else set({ fontSize: n }, "Change font size");
            }}
          />
        </div>
      )}

      <div className="sec">
        <h4>Opacity</h4>
        <NumField label="%" value={Math.round(first.opacity * 100)} min={0} onCommit={(n) => set({ opacity: Math.min(100, n) / 100 }, "Change opacity")} />
      </div>
    </aside>
  );
}
