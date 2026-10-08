import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exportDesign } from "../project/exporter";
import { getRecents, inTauri, newProject, openProject, openProjectAt, saveNow } from "../project/project";
import { currentDoc, getState, redo, undo } from "../state/store";
import { getLayout, resetLayout, setLayout } from "./layout";
import { deleteSelection, detachSelection, duplicateSelection, groupSelection, makeComponent, toggleAutoLayout, toggleLock, ungroupSelection } from "./actions";

/**
 * The menu bar at the top of the screen. It holds what people expect to find there, so nothing
 * has to be learned from a shortcut alone. Every item does something that also works from the app.
 */

const SITE = "https://duet.noisyarchitects.org";
const send = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const zoomBy = (k: number) => send("duet:zoom", Math.max(0.02, Math.min(64, getState().viewport.zoom * k)));
const dummy = () => undefined;

export async function installMenu() {
  if (!inTauri()) return;
  const item = (text: string, action: () => void, accelerator?: string) => MenuItem.new({ text, action, accelerator });
  const line = () => PredefinedMenuItem.new({ item: "Separator" });
  const hasFrames = () => Object.values(currentDoc().elements).some((e) => e.type === "frame" || e.type === "instance");

  const recents = getRecents().slice(0, 10);
  const recentItems = recents.length
    ? await Promise.all(recents.map((r) => item(r.name, () => void openProjectAt(r.path))))
    : [await MenuItem.new({ text: "Nothing yet", enabled: false, action: dummy })];

  const app = await Submenu.new({
    text: "Duet",
    items: [
      await PredefinedMenuItem.new({ item: { About: { name: "Duet", version: "0.2.0" } } }),
      await line(),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await line(),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const file = await Submenu.new({
    text: "File",
    items: [
      await item("New project…", () => void newProject(), "CmdOrCtrl+N"),
      await item("Open…", () => void openProject(), "CmdOrCtrl+O"),
      await Submenu.new({ text: "Open recent", items: recentItems }),
      await item("All projects", () => send("duet:home"), "CmdOrCtrl+Shift+O"),
      await line(),
      await item("Save", () => void saveNow(), "CmdOrCtrl+S"),
      await item("Save a version…", () => send("duet:versions"), "CmdOrCtrl+Shift+S"),
      await line(),
      await item("Export as PNG…", () => void exportDesign("png", 2)),
      await item("Export as SVG…", () => void exportDesign("svg", 1)),
      await line(),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
    ],
  });

  const edit = await Submenu.new({
    text: "Edit",
    items: [
      await item("Undo", undo),
      await item("Redo", redo),
      await line(),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await item("Duplicate", duplicateSelection),
      await item("Select all", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true, ctrlKey: true, bubbles: true }))),
      await item("Delete", deleteSelection),
    ],
  });

  const design = await Submenu.new({
    text: "Design",
    items: [
      await item("Group", groupSelection),
      await item("Ungroup", ungroupSelection),
      await line(),
      await item("Make a component", makeComponent),
      await item("Detach from the original", detachSelection),
      await line(),
      await item("Add or remove auto layout", toggleAutoLayout),
      await item("Lock or unlock", toggleLock),
      await line(),
      await item("Choose pictures…", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, shiftKey: true, bubbles: true }))),
    ],
  });

  const view = await Submenu.new({
    text: "View",
    items: [
      await item("Zoom in", () => zoomBy(1.25), "CmdOrCtrl+="),
      await item("Zoom out", () => zoomBy(0.8), "CmdOrCtrl+-"),
      await item("Actual size", () => send("duet:zoom", 1), "CmdOrCtrl+0"),
      await item("Fit everything", () => send("duet:fit")),
      await item("Zoom to selection", () => send("duet:fit-selection")),
      await line(),
      await item("Show or hide the layers panel", () => setLayout({ leftHidden: !getLayout().leftHidden }), "CmdOrCtrl+Alt+1"),
      await item("Show or hide the design panel", () => setLayout({ rightHidden: !getLayout().rightHidden }), "CmdOrCtrl+Alt+2"),
      await item("Swap the panel sides", () => setLayout({ swapped: !getLayout().swapped })),
      await item("Reset the layout", resetLayout),
      await line(),
      await MenuItem.new({ text: "Present", enabled: hasFrames(), action: () => send("duet:present"), accelerator: "CmdOrCtrl+Enter" }),
      await line(),
      await PredefinedMenuItem.new({ item: "Fullscreen" }),
    ],
  });

  const windowMenu = await Submenu.new({
    text: "Window",
    items: [await PredefinedMenuItem.new({ item: "Minimize" }), await PredefinedMenuItem.new({ item: "Maximize" })],
  });

  const help = await Submenu.new({
    text: "Help",
    items: [
      await item("Duet website", () => void openUrl(SITE)),
      await item("What is new", () => void openUrl(`${SITE}/updates/`)),
      await item("Send feedback", () => void openUrl(`${SITE}/feedback/`)),
      await item("Source on GitHub", () => void openUrl("https://github.com/justsourish/duet")),
    ],
  });

  const menu = await Menu.new({ items: [app, file, edit, design, view, windowMenu, help] });
  await menu.setAsAppMenu();
}
