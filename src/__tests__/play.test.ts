import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { getState, loadDoc, setClock } from "../state/store";
import { clipsLead, pause, shuttle } from "../video/play";

describe("J and L shuttle", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    d = runCommand(d, "set_props", { ids: ["f"], props: { duration: 10 } });
    loadDoc(d);
    setClock({ scene: "f", t: 5, playing: false });
  });
  afterEach(() => {
    pause();
    vi.unstubAllGlobals();
  });

  it("L plays, and pressing again doubles the speed up to eight times", () => {
    shuttle(1);
    expect(getState().clock.playing).toBe(true);
    expect(clipsLead()).toBe(true);
    shuttle(1);
    expect(clipsLead()).toBe(false);
    shuttle(1);
    shuttle(1);
    shuttle(1);
    expect(getState().clock.playing).toBe(true);
  });

  it("J plays backwards, and K stops it", () => {
    shuttle(-1);
    expect(getState().clock.playing).toBe(true);
    expect(clipsLead()).toBe(false);
    pause();
    expect(getState().clock.playing).toBe(false);
    expect(clipsLead()).toBe(true);
  });

  it("J at the very start does nothing", () => {
    setClock({ t: 0 });
    shuttle(-1);
    expect(getState().clock.playing).toBe(false);
  });

  it("pressing the other way goes back to normal speed in that direction", () => {
    shuttle(1);
    shuttle(1);
    shuttle(-1);
    expect(getState().clock.playing).toBe(true);
    expect(clipsLead()).toBe(false);
  });
});
