import { describe, expect, it, vi } from "vitest";

import {
  createActionRegistry,
  formatShortcut,
  handleShortcutKey,
  isDialogOpen,
  isEditableTarget,
  shortcutHint,
  type Action,
} from "./actions";

const save = (): Action => ({
  id: "Comfy.SaveWorkflow",
  label: "保存",
  shortcut: { key: "s", ctrl: true },
  allowWhileTyping: true,
  allowWhileDialog: true,
  run: vi.fn(),
});

describe("formatShortcut", () => {
  it("uses Ctrl+ labels elsewhere and menu glyphs on Mac", () => {
    expect(formatShortcut({ key: "s", ctrl: true }, "other")).toBe("Ctrl+S");
    expect(formatShortcut({ key: "s", ctrl: true }, "mac")).toBe("⌘S");
    expect(formatShortcut({ key: "z", ctrl: true }, "mac")).toBe("⌘Z");
    expect(formatShortcut({ key: "z", ctrl: true, shift: true }, "other")).toBe("Ctrl+Shift+Z");
    expect(formatShortcut({ key: "z", ctrl: true, shift: true }, "mac")).toBe("⇧⌘Z");
    expect(formatShortcut({ key: "y", ctrl: true }, "mac")).toBe("⌘Y");
    expect(shortcutHint({ key: "z", ctrl: true })).toBe("Ctrl+Z / ⌘Z");
  });
});

describe("handleShortcutKey", () => {
  const idle = { typing: false, dialogOpen: false };

  it("matches ctrl and meta, and ignores a bare key or a modifier by itself", () => {
    const action = save();
    expect(handleShortcutKey([action], { key: "s", ctrlKey: true }, idle)).toBe(true);
    expect(handleShortcutKey([action], { key: "s", metaKey: true }, idle)).toBe(true);
    expect(handleShortcutKey([action], { key: "s" }, idle)).toBe(false);
    expect(handleShortcutKey([action], { key: "Control", ctrlKey: true }, idle)).toBe(false);
    expect(action.run).toHaveBeenCalledTimes(2);
  });

  it("requires the same shift and alt state as the combo", () => {
    const action = save();
    expect(handleShortcutKey([action], { key: "S", ctrlKey: true, shiftKey: true }, idle)).toBe(false);
    expect(handleShortcutKey([action], { key: "s", ctrlKey: true, altKey: true }, idle)).toBe(false);
    expect(action.run).not.toHaveBeenCalled();
  });

  it("still consumes a disabled command without running it", () => {
    const action: Action = { ...save(), enabled: () => false };
    expect(handleShortcutKey([action], { key: "s", ctrlKey: true }, idle)).toBe(true);
    expect(action.run).not.toHaveBeenCalled();
  });
});

describe("guards", () => {
  it("treats inputs, textareas, and contenteditable as typing", () => {
    const closest = (selector: string) => (selector.includes("input") ? {} : null);
    expect(isEditableTarget({ closest } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("looks for an open dialog or alertdialog", () => {
    let seen = "";
    isDialogOpen({
      querySelector: (selector: string) => {
        seen = selector;
        return null;
      },
    } as unknown as ParentNode);
    expect(seen).toContain("[role='dialog'][data-state='open']");
    expect(seen).toContain("[role='alertdialog'][data-state='open']");
    expect(isDialogOpen({ querySelector: () => ({}) } as unknown as ParentNode)).toBe(true);
  });
});

describe("action registry", () => {
  it("replaces by id and lets the previous unregister function leave the new command", () => {
    const registry = createActionRegistry();
    const first: Action = { id: "Comfy.Undo", label: "撤销", run: () => {} };
    const unregister = registry.registerAll([first]);
    const second: Action = { id: "Comfy.Undo", label: "撤销", run: () => {} };
    registry.register(second);
    unregister();
    expect(registry.get("Comfy.Undo")).toBe(second);
    expect(registry.list()).toEqual([second]);
    const again = registry.list();
    expect(registry.list()).toBe(again);
  });

  it("notifies subscribers and drops the command on its own unregister", () => {
    const registry = createActionRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const action: Action = { id: "Comfy.Redo", label: "重做", run: () => {} };
    const unregister = registry.register(action);
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    expect(registry.get("Comfy.Redo")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
