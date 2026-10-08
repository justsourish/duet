import { useState } from "react";
import { currentDoc, dispatch, select, useStore } from "../state/store";
import type { Doc, El } from "../document/types";

function Icon({ type }: { type: El["type"] }) {
  if (type === "text") return <span className="ico t">T</span>;
  return <span className={`ico ${type === "frame" ? "f" : ""} ${type === "ellipse" ? "round" : ""}`} />;
}

function Row({ doc, id, depth }: { doc: Doc; id: string; depth: number }) {
  const el = doc.elements[id];
  const selection = useStore((s) => s.selection);
  const [renaming, setRenaming] = useState(false);
  if (!el) return null;
  const selected = selection.includes(id);

  const commitName = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== el.name) dispatch("set_props", { ids: [id], props: { name }, label: "Rename" });
  };

  return (
    <>
      <div
        className={`row ${selected ? "sel" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => {
          if (e.shiftKey) select(selected ? selection.filter((i) => i !== id) : [...selection, id]);
          else select([id]);
        }}
        onDoubleClick={() => setRenaming(true)}
      >
        <Icon type={el.type} />
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={el.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitName(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="name">{el.name}</span>
        )}
      </div>
      {[...el.childIds].reverse().map((c) => (
        <Row key={c} doc={doc} id={c} depth={depth + 1} />
      ))}
    </>
  );
}

export default function LayersPanel() {
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const doc = currentDoc();
  return (
    <aside className="left">
      <div className="panel-title">Layers</div>
      <div className="layers">
        {doc.rootIds.length === 0 && <div className="empty">Nothing here yet.</div>}
        {[...doc.rootIds].reverse().map((id) => (
          <Row key={id} doc={doc} id={id} depth={0} />
        ))}
      </div>
    </aside>
  );
}
