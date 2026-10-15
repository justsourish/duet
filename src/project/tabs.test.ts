import { beforeEach, describe, expect, it } from "vitest";
import { addTab, closeTab, getTabs } from "./project";

describe("open projects as tabs", () => {
  beforeEach(() => {
    for (const p of [...getTabs()]) closeTab(p);
  });

  it("keeps projects once, in the order they were opened", () => {
    addTab("/a/one.duet");
    addTab("/a/two.duet");
    addTab("/a/one.duet");
    expect(getTabs()).toEqual(["/a/one.duet", "/a/two.duet"]);
  });

  it("closing one says which to show next, and the last one leaves nothing", () => {
    addTab("/a/one.duet");
    addTab("/a/two.duet");
    addTab("/a/three.duet");
    expect(closeTab("/a/two.duet")).toBe("/a/three.duet");
    expect(closeTab("/a/three.duet")).toBe("/a/one.duet");
    expect(closeTab("/a/one.duet")).toBeNull();
    expect(getTabs()).toEqual([]);
  });

  it("holds at most twelve", () => {
    for (let i = 0; i < 15; i++) addTab(`/a/p${i}.duet`);
    expect(getTabs().length).toBe(12);
    expect(getTabs()[11]).toBe("/a/p14.duet");
  });
});
