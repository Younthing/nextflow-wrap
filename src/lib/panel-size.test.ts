import { describe, expect, it } from "vitest";

import { dragPanel, nudgePanel, readPanelState, shownWidth, type PanelSpec } from "./panel-size";

const spec: PanelSpec = { min: 200, max: 500, defaultWidth: 250, collapsedWidth: 0, collapseBelow: 140 };
const open = { width: 300, collapsed: false };

describe("dragPanel", () => {
  it("follows the pointer within the limits", () => {
    expect(dragPanel(spec, open, 320.4)).toEqual({ width: 320, collapsed: false });
    expect(dragPanel(spec, open, 900)).toEqual({ width: 500, collapsed: false });
    expect(dragPanel(spec, open, 160)).toEqual({ width: 200, collapsed: false });
  });

  it("collapses past the threshold and remembers the open width", () => {
    expect(dragPanel(spec, open, 100)).toEqual({ width: 300, collapsed: true });
  });

  it("opens a collapsed panel dragged past the threshold", () => {
    expect(dragPanel(spec, { width: 300, collapsed: true }, 150)).toEqual({ width: 200, collapsed: false });
  });
});

describe("nudgePanel", () => {
  it("steps the width and stops at the minimum instead of collapsing", () => {
    expect(nudgePanel(spec, open, 16)).toEqual({ width: 316, collapsed: false });
    expect(nudgePanel(spec, { width: 205, collapsed: false }, -16)).toEqual({ width: 200, collapsed: false });
  });

  it("opens a collapsed panel on a widening step only", () => {
    const shut = { width: 300, collapsed: true };
    expect(nudgePanel(spec, shut, 16)).toEqual({ width: 300, collapsed: false });
    expect(nudgePanel(spec, shut, -16)).toBe(shut);
  });
});

describe("shownWidth and readPanelState", () => {
  it("shows the collapsed width while shut", () => {
    expect(shownWidth(spec, { width: 300, collapsed: true })).toBe(0);
    expect(shownWidth({ ...spec, collapsedWidth: 56 }, { width: 300, collapsed: true })).toBe(56);
    expect(shownWidth(spec, open)).toBe(300);
  });

  it("repairs stored values", () => {
    expect(readPanelState(spec, null)).toEqual({ width: 250, collapsed: false });
    expect(readPanelState(spec, { width: "wide", collapsed: "yes" })).toEqual({ width: 250, collapsed: false });
    expect(readPanelState(spec, { width: 9000, collapsed: true })).toEqual({ width: 500, collapsed: true });
  });
});
