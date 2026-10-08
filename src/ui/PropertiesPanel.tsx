import { useEffect, useState } from "react";
import { currentDoc, dispatch, select, useStore } from "../state/store";
import type { El, Layout } from "../document/types";
import { defaultLayout } from "../document/layout";
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
  const valid = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
  return (
    <div className="f color">
      <input
        type="color"
        value={value && valid(value) && value.length >= 7 ? value.slice(0, 7) : "#000000"}
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

function Seg<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="seg2">
      {options.map(([v, label]) => (
        <span key={v} className={value === v ? "on" : ""} onClick={() => onPick(v)}>
          {label}
        </span>
      ))}
    </div>
  );
}

function LayoutSection({ frame }: { frame: El }) {
  const l = frame.layout;
  if (!l) {
    return (
      <div className="sec">
        <h4>Auto layout</h4>
        <div className="linkbtn" onClick={() => dispatch("set_layout", { id: frame.id, layout: defaultLayout() })}>
          + Add auto layout
        </div>
        <div className="hint2">Lines up what is inside this frame. Shortcut: Shift A.</div>
      </div>
    );
  }
  const change = (patch: Partial<Layout>, label: string) => dispatch("set_props", { ids: [frame.id], props: { layout: { ...l, ...patch } }, label });
  return (
    <div className="sec">
      <h4>Auto layout</h4>
      <Seg value={l.dir} options={[["column", "Vertical"], ["row", "Horizontal"]]} onPick={(dir) => change({ dir }, "Change direction")} />
      <div className="gap" />
      <div className="field">
        <NumField label="Gap" value={l.gap} min={0} onCommit={(n) => change({ gap: n }, "Change gap")} />
        <div />
        <NumField label="Pad X" value={l.padX} min={0} onCommit={(n) => change({ padX: n }, "Change padding")} />
        <NumField label="Pad Y" value={l.padY} min={0} onCommit={(n) => change({ padY: n }, "Change padding")} />
      </div>
      <div className="gap" />
      <Seg value={l.align} options={[["start", "Start"], ["center", "Middle"], ["end", "End"], ["stretch", "Stretch"]]} onPick={(align) => change({ align }, "Change alignment")} />
      <div className="gap" />
      <Seg value={l.justify} options={l.dir === "row" ? [["start", "Left"], ["center", "Centre"], ["end", "Right"], ["between", "Spread"]] : [["start", "Top"], ["center", "Centre"], ["end", "Bottom"], ["between", "Spread"]]} onPick={(justify) => change({ justify }, "Change spacing")} />
      <div className="gap" />
      <Seg value={l.hug ? "hug" : "fixed"} options={[["hug", "Hug content"], ["fixed", "Fixed size"]]} onPick={(v) => change({ hug: v === "hug" }, "Change sizing")} />
      <div className="linkbtn" style={{ marginTop: 10 }} onClick={() => dispatch("set_layout", { id: frame.id, layout: null })}>
        Remove auto layout
      </div>
    </div>
  );
}

function ComponentSection({ el, copies }: { el: El; copies: number }) {
  const doc = currentDoc();
  if (el.component) {
    return (
      <div className="sec">
        <h4>Component</h4>
        <div className="hint2">
          This is the original. Change it and {copies === 0 ? "every copy you place" : copies === 1 ? "its one copy" : `all ${copies} copies`} will follow.
        </div>
      </div>
    );
  }
  const main = doc.elements[el.componentId];
  const changed = Object.keys(el.overrides).length > 0;
  return (
    <div className="sec">
      <h4>Copy of {main ? main.name : "a component"}</h4>
      <div className="hint2">
        It follows the original, except for what you change here.
      </div>
      <div className="gap" />
      {main && (
        <div className="linkbtn" onClick={() => select([main.id])}>
          Go to the original
        </div>
      )}
      {changed && (
        <div className="linkbtn" style={{ marginTop: 6 }} onClick={() => dispatch("reset_overrides", { id: el.id })}>
          Undo my changes to this copy
        </div>
      )}
      <div className="linkbtn" style={{ marginTop: 6 }} onClick={() => dispatch("detach_instance", { id: el.id })}>
        Detach from the original
      </div>
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
  const frames = Object.values(doc.elements).filter((e) => e.type === "frame");
  const one = els.length === 1 ? els[0] : null;
  const set = (props: Partial<El>, label?: string) => dispatch("set_props", { ids, props, label });
  const first = els[0];
  const allText = els.every((e) => e.type === "text");
  const allImages = els.every((e) => e.type === "image");
  const allGroups = els.every((e) => e.type === "group");
  const noFill = allImages || allGroups || els.every((e) => e.type === "path" && !e.closed);
  const hasRadius = els.every((e) => e.type === "frame" || e.type === "rect" || e.type === "image");

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

      {!noFill && (
        <div className="sec">
          <h4>{allText ? "Text colour" : "Fill"}</h4>
          {!allText && (
            <div className="seg2">
              <span className={!first.gradient ? "on" : ""} onClick={() => first.gradient && set({ gradient: null }, "Use a solid fill")}>
                Solid
              </span>
              <span
                className={first.gradient ? "on" : ""}
                onClick={() => !first.gradient && set({ gradient: { from: first.fill, to: "#7c5cff", angle: 90 } }, "Use a gradient")}
              >
                Gradient
              </span>
            </div>
          )}
          {first.gradient && !allText ? (
            <>
              <ColorField value={first.gradient.from} onCommit={(c) => c && set({ gradient: { ...first.gradient!, from: c } }, "Change gradient")} />
              <div className="gap" />
              <ColorField value={first.gradient.to} onCommit={(c) => c && set({ gradient: { ...first.gradient!, to: c } }, "Change gradient")} />
              <div className="gap" />
              <NumField label="Angle" value={first.gradient.angle} onCommit={(n) => set({ gradient: { ...first.gradient!, angle: n } }, "Change gradient angle")} />
            </>
          ) : (
            <ColorField value={first.fill} onCommit={(c) => c && set({ fill: c }, "Change fill")} />
          )}
        </div>
      )}

      {one && (one.component || one.type === "instance") && (
        <ComponentSection el={one} copies={Object.values(doc.elements).filter((e) => e.type === "instance" && e.componentId === one.id && !e.id.includes("::")).length} />
      )}

      {one?.type === "frame" && <LayoutSection frame={one} />}

      {one && one.parentId && doc.elements[one.parentId]?.layout && (
        <div className="sec">
          <h4>In auto layout</h4>
          <Seg value={one.grow ? "fill" : "keep"} options={[["keep", "Keep size"], ["fill", "Fill space"]]} onPick={(v) => set({ grow: v === "fill" ? 1 : 0 }, "Change sizing")} />
        </div>
      )}

      {!allText && !allGroups && (
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

      {!allText && !allGroups && (
        <div className="sec">
          <h4>Shadow</h4>
          {first.shadow ? (
            <>
              <div className="field">
                <NumField label="X" value={first.shadow.x} onCommit={(n) => set({ shadow: { ...first.shadow!, x: n } }, "Change shadow")} />
                <NumField label="Y" value={first.shadow.y} onCommit={(n) => set({ shadow: { ...first.shadow!, y: n } }, "Change shadow")} />
                <NumField label="Blur" value={first.shadow.blur} min={0} onCommit={(n) => set({ shadow: { ...first.shadow!, blur: n } }, "Change shadow")} />
              </div>
              <div className="gap" />
              <ColorField value={first.shadow.color} onCommit={(c) => c && set({ shadow: { ...first.shadow!, color: c } }, "Change shadow")} />
              <div className="gap" />
              <div className="linkbtn" onClick={() => set({ shadow: null }, "Remove shadow")}>
                Remove shadow
              </div>
            </>
          ) : (
            <div className="linkbtn" onClick={() => set({ shadow: { x: 0, y: 8, blur: 24, color: "#00000040" } }, "Add shadow")}>
              + Add a shadow
            </div>
          )}
        </div>
      )}

      {one && frames.length > 0 && (
        <div className="sec">
          <h4>Prototype</h4>
          <label className="f">
            <span>Opens</span>
            <select value={one.link ?? ""} onChange={(e) => set({ link: e.target.value || null }, e.target.value ? "Link to a screen" : "Remove link")}>
              <option value="">Nothing</option>
              {frames
                .filter((f) => f.id !== one.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="hint2">Press Present at the top to click through your screens.</div>
        </div>
      )}

      <div className="sec">
        <h4>Opacity</h4>
        <NumField label="%" value={Math.round(first.opacity * 100)} min={0} onCommit={(n) => set({ opacity: Math.min(100, n) / 100 }, "Change opacity")} />
      </div>
    </aside>
  );
}
