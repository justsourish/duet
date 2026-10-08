import { newId } from "../commands";
import { componentsIn } from "../document/components";
import { worldPos } from "../document/geometry";
import { currentDoc, dispatch, getState, select, useStore } from "../state/store";
import Icon from "./Icons";

/** The components in this design. Click one to put a copy on the canvas. */
function place(componentId: string) {
  const doc = currentDoc();
  const main = doc.elements[componentId];
  if (!main) return;
  const sel = getState().selection;
  const parent = sel.length === 1 && doc.elements[sel[0]]?.type === "frame" && !doc.elements[sel[0]].component ? sel[0] : null;
  const wrap = document.querySelector(".canvas-wrap");
  const vp = getState().viewport;
  const cx = ((wrap?.clientWidth ?? 800) / 2 - vp.x) / vp.zoom;
  const cy = ((wrap?.clientHeight ?? 600) / 2 - vp.y) / vp.zoom;
  const origin = parent ? worldPos(doc, parent) : { x: 0, y: 0 };
  const id = newId("instance");
  dispatch("create_instance", {
    componentId,
    id,
    parentId: parent,
    x: Math.round(cx - main.width / 2 - origin.x),
    y: Math.round(cy - main.height / 2 - origin.y),
  });
  if (currentDoc().elements[id]) select([id]);
}

export default function AssetsPanel() {
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const list = componentsIn(currentDoc());
  return (
    <div className="skills">
      <div className="h">Components</div>
      {list.length === 0 && (
        <div className="empty">
          Select a frame or group and press Cmd Option K to make it a component. Then you can place as many copies as you like, and changing the original changes them all.
        </div>
      )}
      {list.map((c) => (
        <div key={c.id} className="skill asset" onClick={() => place(c.id)} title="Click to place a copy">
          <Icon name="component" size={14} className="ico" />
          <div className="grow">
            <div>{c.name}</div>
            <div className="hint2">
              {Math.round(c.width)} by {Math.round(c.height)}
            </div>
          </div>
          <span className="add-copy">Place</span>
        </div>
      ))}
    </div>
  );
}
