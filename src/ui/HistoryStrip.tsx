import { goTo, redo, undo, useStore } from "../state/store";

export default function HistoryStrip() {
  const timeline = useStore((s) => s.timeline);
  const cursor = useStore((s) => s.cursor);
  return (
    <footer className="hist">
      <span className="note">History</span>
      <button className="mini" disabled={cursor === 0} onClick={undo} title="Undo (Ctrl or Cmd Z)">
        Undo
      </button>
      <button className="mini" disabled={cursor >= timeline.length - 1} onClick={redo} title="Redo (Shift Ctrl or Cmd Z)">
        Redo
      </button>
      <div className="track">
        {timeline.map((e, i) => (
          <button
            key={i}
            className={`pt ${e.actor === "ai" ? "ai" : ""} ${i === cursor ? "now" : ""} ${i > cursor ? "future" : ""}`}
            data-tip={e.label}
            onClick={() => goTo(i)}
            aria-label={e.label}
          />
        ))}
      </div>
      <span className="note">Click a point to go back to it.</span>
    </footer>
  );
}
