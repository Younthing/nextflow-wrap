import { describe, expect, it, vi } from "vitest";

import {
  EDITOR_CHROME_CLASS,
  MARQUEE_TEXT_CLASS,
  beginMarqueeTextGuard,
  clearMarqueeTextSelection,
  isCanvasMarqueePointerDown,
  releaseMarqueeTextGuard,
  shouldClearMarqueeTextSelection,
  shouldPreventMarqueeSelectStart,
  type MarqueeTextRoot,
} from "./marquee-text";

function anchor(editable: boolean) {
  return {
    nodeType: 1,
    closest: (selector: string) => {
      expect(selector).toContain("input");
      return editable ? {} : null;
    },
  };
}

function selection(editable: boolean, collapsed = false) {
  const state = {
    isCollapsed: collapsed,
    anchorNode: anchor(editable),
    removeAllRanges: vi.fn(() => {
      state.isCollapsed = true;
    }),
  };
  return state;
}

function root(editable = false, collapsed = false): MarqueeTextRoot & { classes: Set<string>; selection: ReturnType<typeof selection> } {
  const classes = new Set<string>();
  const current = selection(editable, collapsed);
  return {
    classes,
    selection: current,
    documentElement: {
      classList: {
        add: (token: string) => classes.add(token),
        remove: (token: string) => classes.delete(token),
      },
    },
    getSelection: () => current,
  };
}

describe("isCanvasMarqueePointerDown", () => {
  const pane = { closest: () => null } as unknown as EventTarget;
  const field = anchor(true) as unknown as EventTarget;

  it("is a primary Shift-press on the canvas, not a field or another button", () => {
    expect(isCanvasMarqueePointerDown({ button: 0, shiftKey: true, target: pane })).toBe(true);
    expect(isCanvasMarqueePointerDown({ button: 0, shiftKey: true, target: field })).toBe(false);
    expect(isCanvasMarqueePointerDown({ button: 0, shiftKey: false, target: pane })).toBe(false);
    expect(isCanvasMarqueePointerDown({ button: 2, shiftKey: true, target: pane })).toBe(false);
    expect(isCanvasMarqueePointerDown({ button: 0, shiftKey: true, target: null })).toBe(true);
  });
});

describe("marquee text selection", () => {
  it("clears a chrome range and keeps one inside a field", () => {
    const chrome = selection(false);
    expect(shouldClearMarqueeTextSelection(chrome)).toBe(true);
    expect(clearMarqueeTextSelection({ getSelection: () => chrome })).toBe(true);
    expect(chrome.removeAllRanges).toHaveBeenCalledOnce();

    const field = selection(true);
    expect(shouldClearMarqueeTextSelection(field)).toBe(false);
    expect(clearMarqueeTextSelection({ getSelection: () => field })).toBe(false);
    expect(field.removeAllRanges).not.toHaveBeenCalled();
  });

  it("ignores a caret and a missing selection, and clears a range with no anchor", () => {
    expect(shouldClearMarqueeTextSelection(selection(false, true))).toBe(false);
    expect(clearMarqueeTextSelection({ getSelection: () => null })).toBe(false);
    expect(clearMarqueeTextSelection({})).toBe(false);
    const orphan = {
      isCollapsed: false,
      anchorNode: { nodeType: 3, parentElement: null },
      removeAllRanges: vi.fn(),
    };
    expect(clearMarqueeTextSelection({ getSelection: () => orphan })).toBe(true);
    expect(orphan.removeAllRanges).toHaveBeenCalledOnce();
  });

  it("clears a text node whose parent sits outside a field", () => {
    const outside = {
      isCollapsed: false,
      anchorNode: {
        nodeType: 3,
        parentElement: { closest: () => null },
      },
      removeAllRanges: vi.fn(),
    };
    expect(shouldClearMarqueeTextSelection(outside)).toBe(true);
  });
});

describe("marquee text guard", () => {
  it("marks the document and drops a chrome highlight when the drag starts", () => {
    const doc = root(false);
    beginMarqueeTextGuard(doc);
    expect(doc.classes.has(MARQUEE_TEXT_CLASS)).toBe(true);
    expect(doc.selection.removeAllRanges).toHaveBeenCalledOnce();
    expect(EDITOR_CHROME_CLASS).toBe("nf-chrome");
  });

  it("leaves a field selection in place when the guard starts", () => {
    const doc = root(true);
    beginMarqueeTextGuard(doc);
    expect(doc.classes.has(MARQUEE_TEXT_CLASS)).toBe(true);
    expect(doc.selection.removeAllRanges).not.toHaveBeenCalled();
  });

  it("clears again on the next frame and then removes the class", () => {
    const doc = root(false);
    beginMarqueeTextGuard(doc);
    // The browser can commit a fresh range after pointerup listeners return.
    doc.selection.isCollapsed = false;
    doc.selection.removeAllRanges.mockClear();
    const queued: Array<() => void> = [];
    releaseMarqueeTextGuard(doc, () => false, (callback) => queued.push(callback));
    expect(doc.selection.removeAllRanges).toHaveBeenCalledOnce();
    expect(doc.classes.has(MARQUEE_TEXT_CLASS)).toBe(true);
    doc.selection.isCollapsed = false;
    queued[0]?.();
    expect(doc.selection.removeAllRanges).toHaveBeenCalledTimes(2);
    expect(doc.classes.has(MARQUEE_TEXT_CLASS)).toBe(false);
  });

  it("keeps the class when a new marquee starts before the frame", () => {
    const doc = root(true, true);
    beginMarqueeTextGuard(doc);
    const queued: Array<() => void> = [];
    releaseMarqueeTextGuard(doc, () => true, (callback) => queued.push(callback));
    queued[0]?.();
    expect(doc.classes.has(MARQUEE_TEXT_CLASS)).toBe(true);
  });

  it("prevents selectstart only while guarding and only outside fields", () => {
    const pane = { closest: () => null } as unknown as EventTarget;
    const field = anchor(true) as unknown as EventTarget;
    expect(shouldPreventMarqueeSelectStart(false, pane)).toBe(false);
    expect(shouldPreventMarqueeSelectStart(true, field)).toBe(false);
    expect(shouldPreventMarqueeSelectStart(true, pane)).toBe(true);
    expect(shouldPreventMarqueeSelectStart(true, null)).toBe(true);
  });
});
