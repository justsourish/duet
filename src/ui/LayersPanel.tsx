import Icon from "./Icons";
import { useRef, useState } from "react";
import { descendants, topLevelOnly } from "../document/geometry";
import type { Doc, El } from "../document/types";
import { currentDoc, dispatch, getState, select, useStore } from "../state/store";
import SkillsPanel from "./SkillsPanel";

type Zone = "before" | "after" | "inside";
interface Drop {
  id: string | null; // null means the empty space at the bottom of the list
  zone: Zone;
}

function LayerIcon({ type }: { type: El["type"] }) {
  const name = type === "text" ? "text" : type === "image" ? "image" : type === "frame" ? "frame" : type === "ellipse" ? "ellipse" : "rect";
  return <Icon name={name} size={14} className="ico" />;
}

interface DndProps {
  drop: Drop | null;
  setDrop: (d: Drop | null) => void;
  onStart: (id: string) => void;
  onDropOn: (d: Drop) => void;
  canDrop: (targetId: string) => boolean;
}

function Row({ doc, id, depth, dnd }: { doc: Doc; id: string; depth: number; dnd: DndProps }) {
  const el = doc.elements[id];
  const selection = useStore((s) => s.selection);
  const [renaming, setRenaming] = useState(false);
  if (!el) return null;
  const selected = selection.includes(id);
  const over = dnd.drop?.id === id ? dnd.drop.zone : null;

  const commitName = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== el.name) dispatch("set_props", { ids: [id], props: { name }, label: "Rename" });
  };

  const zoneFor = (e: React.DragEvent<HTMLDivElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (el.type === "frame") return t < 0.25 ? "before" : t > 0.75 ? "after" : "inside";
    return t < 0.5 ? "before" : "after";
  };

  return (
    <>
      <div
        className={`row ${selected ? "sel" : ""} ${over ? `drop-${over}` : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);
          dnd.onStart(id);
        }}
        onDragOver={(e) => {
          if (!dnd.canDrop(id)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const zone = zoneFor(e);
          if (dnd.drop?.id !== id || dnd.drop.zone !== zone) dnd.setDrop({ id, zone });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dnd.onDropOn({ id, zone: zoneFor(e) });
        }}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            // jump to it, so you can always find where something is
            select([id]);
            window.dispatchEvent(new CustomEvent("duet:fit-selection", { detail: [id] }));
          } else if (e.shiftKey) select(selected ? selection.filter((i) => i !== id) : [...selection, id]);
          else {
            select([id]);
            window.dispatchEvent(new CustomEvent("duet:reveal", { detail: [id] }));
          }
        }}
        onDoubleClick={() => setRenaming(true)}
      >
        <LayerIcon type={el.type} />
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
        <Row key={c} doc={doc} id={c} depth={depth + 1} dnd={dnd} />
      ))}
    </>
  );
}

export default function LayersPanel() {
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const doc = currentDoc();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [tab, setTab] = useState<"layers" | "skills">("layers");
  const dragging = useRef<string[]>([]);

  const end = () => {
    dragging.current = [];
    setDrop(null);
  };

  /** Where would things land? Translate a visual drop target into a parent and a position. */
  const apply = (d: Drop) => {
    const ids = dragging.current;
    end();
    if (ids.length === 0) return;
    let parentId: string | null = null;
    let index: number | undefined;
    let label = "Reorder layers";

    if (d.id === null) {
      parentId = null; // bottom of the list: back to the page, in front
    } else {
      const target = doc.elements[d.id];
      if (d.zone === "inside" && target.type === "frame") {
        parentId = target.id;
        label = `Move into ${target.name}`;
      } else {
        parentId = target.parentId;
        const siblings = parentId ? doc.elements[parentId].childIds : doc.rootIds;
        const at = siblings.indexOf(target.id);
        // The list is shown front to back, so "above" a row means later in the array.
        index = d.zone === "before" ? at + 1 : at;
        label = parentId ? `Move into ${doc.elements[parentId].name}` : "Move out of frame";
        if (ids.every((i) => (doc.elements[i].parentId ?? null) === parentId)) label = "Reorder layers";
      }
    }
    dispatch("reparent_elements", { ids, parentId, index, label });
  };

  const dnd: DndProps = {
    drop,
    setDrop,
    onStart: (id) => {
      const selection = getState().selection;
      // Dragging a selected layer drags the whole selection, keeping its stacking order.
      if (selection.includes(id)) {
        const picked = new Set(topLevelOnly(currentDoc(), selection));
        const order: string[] = [];
        const walk = (ids: string[]) =>
          ids.forEach((i) => {
            if (picked.has(i)) order.push(i);
            walk(currentDoc().elements[i]?.childIds ?? []);
          });
        walk(currentDoc().rootIds);
        dragging.current = order;
      } else {
        dragging.current = [id];
      }
    },
    onDropOn: apply,
    canDrop: (targetId) => {
      const ids = dragging.current;
      if (ids.length === 0) return false;
      return !ids.some((i) => i === targetId || descendants(doc, i).includes(targetId));
    },
  };

  return (
    <aside className="left">
      <div className="tabs">
        <div className={`tab ${tab === "layers" ? "on" : ""}`} onClick={() => setTab("layers")}>
          Layers
        </div>
        <div className={`tab ${tab === "skills" ? "on" : ""}`} onClick={() => setTab("skills")}>
          Skills
        </div>
      </div>
      {tab === "skills" && <SkillsPanel />}
      {tab === "layers" && <div className="tip-line">Click a layer to find it. Cmd or Ctrl click to zoom to it.</div>}
      <div
        className="layers"
        hidden={tab !== "layers"}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
        onDragEnd={end}
      >
        {doc.rootIds.length === 0 && <div className="empty">Nothing here yet.</div>}
        {[...doc.rootIds].reverse().map((id) => (
          <Row key={id} doc={doc} id={id} depth={0} dnd={dnd} />
        ))}
        <div
          className={`tail ${drop?.id === null && drop ? "drop-end" : ""}`}
          onDragOver={(e) => {
            if (dragging.current.length === 0) return;
            e.preventDefault();
            setDrop({ id: null, zone: "after" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            apply({ id: null, zone: "after" });
          }}
        />
      </div>
    </aside>
  );
}
