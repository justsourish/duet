import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { sendCopy } from "../project/project";

/** What the copy will leave out, in one plain sentence. */
export function leftOut(history: boolean, conversation: boolean): string {
  if (history && conversation) return "This copy carries how the design was made: every earlier step, your versions and your conversation with the AI.";
  if (history) return "This copy carries every earlier step and your versions. It leaves out your conversation with the AI.";
  if (conversation) return "This copy carries your conversation with the AI. It leaves out the earlier steps and your versions.";
  return "This copy leaves out the earlier steps, your versions and your conversation with the AI.";
}

/**
 * A second file to hand to a client or a friend. It holds the design as it is now and, unless you
 * switch them on, nothing of how it was made. The switches start off every time.
 */
export default function SendCopy({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    // keep the canvas shortcuts quiet while this is open
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setWhy(null);
    const result = await sendCopy({ history, conversation });
    setBusy(false);
    if (!result) return;
    if ("why" in result) setWhy(result.why);
    else setSaved(result.saved);
  };

  return (
    <div className="sheet-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet">
        <div className="sheet-title">Send a copy</div>
        {saved ? (
          <>
            <p className="sheet-lead">The copy is saved. Your project is still the one open here, and nothing in it changed.</p>
            <div className="sheet-path">{saved.replace(/^\/Users\/[^/]+/, "~")}</div>
            <div className="sheet-actions">
              <button className="mini" onClick={() => void revealItemInDir(saved)}>
                Show in folder
              </button>
              <button className="mini primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet-lead">A second file with the design as it is now, to hand to someone else. Your project is not changed.</p>
            <label className="sheet-choice">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
              <span>
                <b>Include the history</b>
                Every earlier step and the versions you named.
              </span>
            </label>
            <label className="sheet-choice">
              <input type="checkbox" checked={conversation} onChange={(e) => setConversation(e.target.checked)} />
              <span>
                <b>Include the conversation</b>
                What you and the AI said in this project.
              </span>
            </label>
            <p className={`sheet-note ${history || conversation ? "warn" : ""}`}>{leftOut(history, conversation)}</p>
            {why && <p className="sheet-note warn">{why}</p>}
            <div className="sheet-actions">
              <button className="mini" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button className="mini primary" disabled={busy} onClick={() => void go()}>
                {busy ? "Saving…" : "Choose where to save…"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
