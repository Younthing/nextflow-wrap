import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { combosOf, handleShortcutKey, shortcutHint, type KeyEvent } from "@/lib/actions";
import { ASSISTANT_PROMPT } from "@/features/assistant/prompt";
import { EDITOR_ACTIONS, editorActions, type EditorCommandHandlers } from "./commands";

const readme = readFileSync(fileURLToPath(new URL("../../../README.md", import.meta.url)), "utf8");

function press(key: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { key, ...mods };
}

function handlers(overrides: Partial<EditorCommandHandlers> = {}): EditorCommandHandlers {
  return {
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    selectAll: vi.fn(),
    deselect: vi.fn(),
    openNodeSearch: vi.fn(),
    fitView: vi.fn(),
    canUndo: () => true,
    canRedo: () => true,
    canCopy: () => true,
    canPaste: () => true,
    canDuplicate: () => true,
    canDelete: () => true,
    canSelectAll: () => true,
    canDeselect: () => true,
    canFitView: () => true,
    ...overrides,
  };
}

describe("editor commands", () => {
  it("uses ComfyUI's command ids and chords", () => {
    expect(EDITOR_ACTIONS.save).toMatchObject({ id: "Comfy.SaveWorkflow", shortcut: { key: "s", ctrl: true } });
    expect(EDITOR_ACTIONS.undo).toMatchObject({ id: "Comfy.Undo", shortcut: { key: "z", ctrl: true } });
    expect(EDITOR_ACTIONS.redo.id).toBe("Comfy.Redo");
    expect(combosOf(EDITOR_ACTIONS.redo)).toEqual([
      { key: "z", ctrl: true, shift: true },
      { key: "y", ctrl: true },
    ]);
    expect(EDITOR_ACTIONS.copy).toMatchObject({ id: "Comfy.Canvas.CopySelected", shortcut: { key: "c", ctrl: true } });
    expect(EDITOR_ACTIONS.paste).toMatchObject({
      id: "Comfy.Canvas.PasteFromClipboard",
      shortcut: { key: "v", ctrl: true },
    });
    expect(EDITOR_ACTIONS.duplicate).toMatchObject({
      id: "Comfy.Canvas.DuplicateSelected",
      shortcut: { key: "d", ctrl: true },
    });
    expect(EDITOR_ACTIONS.delete.id).toBe("Comfy.Canvas.DeleteSelectedItems");
    expect(combosOf(EDITOR_ACTIONS.delete)).toEqual([{ key: "Delete" }, { key: "Backspace" }]);
    expect(EDITOR_ACTIONS.selectAll).toMatchObject({ id: "Comfy.Canvas.SelectAll", shortcut: { key: "a", ctrl: true } });
    expect(EDITOR_ACTIONS.deselect).toMatchObject({ id: "Comfy.Canvas.Deselect", shortcut: { key: "Escape" } });
    expect(EDITOR_ACTIONS.fit.id).toBe("Comfy.Canvas.FitView");
    expect(combosOf(EDITOR_ACTIONS.search)).toEqual([{ key: "k", ctrl: true }, { key: "/" }]);
    expect(combosOf(EDITOR_ACTIONS.fit)).toEqual([{ key: "f" }, { key: "1", shift: true }]);
  });

  it("saves while typing or in a dialog, and keeps undo and redo off both", () => {
    const save = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    const actions = editorActions(handlers({ save, undo, redo }));
    const busy = { typing: true, dialogOpen: true };
    const idle = { typing: false, dialogOpen: false };

    expect(handleShortcutKey(actions, press("s", { ctrlKey: true }), busy)).toBe(true);
    expect(handleShortcutKey(actions, press("s", { metaKey: true }), { typing: true, dialogOpen: false })).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);

    expect(handleShortcutKey(actions, press("z", { ctrlKey: true }), { typing: true, dialogOpen: false })).toBe(false);
    expect(handleShortcutKey(actions, press("z", { metaKey: true }), { typing: false, dialogOpen: true })).toBe(false);
    expect(handleShortcutKey(actions, press("y", { ctrlKey: true }), busy)).toBe(false);
    expect(handleShortcutKey(actions, press("z", { ctrlKey: true, shiftKey: true }), { typing: true, dialogOpen: false })).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();

    expect(handleShortcutKey(actions, press("z", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("Z", { metaKey: true, shiftKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("y", { ctrlKey: true }), idle)).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it("does not redo an empty future or undo an empty past", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const actions = editorActions(handlers({ undo, redo, canUndo: () => false, canRedo: () => false }));
    const idle = { typing: false, dialogOpen: false };
    expect(handleShortcutKey(actions, press("z", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("y", { ctrlKey: true }), idle)).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("quotes the same chords in the readme and the assistant prompt", () => {
    expect(readme).toContain(shortcutHint(EDITOR_ACTIONS.save.shortcut));
    expect(readme).toContain(shortcutHint(EDITOR_ACTIONS.undo.shortcut));
    for (const combo of combosOf(EDITOR_ACTIONS.redo)) {
      expect(readme).toContain(shortcutHint(combo));
    }
    for (const action of [EDITOR_ACTIONS.copy, EDITOR_ACTIONS.paste, EDITOR_ACTIONS.duplicate, EDITOR_ACTIONS.selectAll]) {
      expect(readme).toContain(shortcutHint(action.shortcut));
    }
    for (const combo of combosOf(EDITOR_ACTIONS.delete)) {
      expect(readme).toContain(shortcutHint(combo));
    }
    expect(readme).toContain(shortcutHint(EDITOR_ACTIONS.search.shortcut));
    expect(readme).toContain("或 / 打开节点搜索");
    expect(readme).toContain("Esc 取消选择");
    expect(readme).toContain(`F 或 ${shortcutHint(combosOf(EDITOR_ACTIONS.fit)[1]!)}`);
    expect(ASSISTANT_PROMPT).toContain(shortcutHint(EDITOR_ACTIONS.undo.shortcut));
  });

  it("runs canvas chords only when the canvas has the keyboard", () => {
    const copy = vi.fn();
    const paste = vi.fn();
    const duplicate = vi.fn();
    const remove = vi.fn();
    const selectAll = vi.fn();
    const deselect = vi.fn();
    const openNodeSearch = vi.fn();
    const fitView = vi.fn();
    const actions = editorActions(
      handlers({ copy, paste, duplicate, delete: remove, selectAll, deselect, openNodeSearch, fitView }),
    );
    const idle = { typing: false, dialogOpen: false, menuOpen: false };
    const typing = { typing: true, dialogOpen: false, menuOpen: false };
    const dialog = { typing: false, dialogOpen: true, menuOpen: false };
    const menu = { typing: false, dialogOpen: false, menuOpen: true };

    expect(handleShortcutKey(actions, press("c", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("v", { metaKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("d", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("Delete"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("Backspace"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("a", { metaKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("Escape"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("k", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("/"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("f"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("!", { shiftKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("1", { shiftKey: true }), idle)).toBe(true);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledTimes(1);
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(deselect).toHaveBeenCalledTimes(1);
    expect(openNodeSearch).toHaveBeenCalledTimes(2);
    expect(fitView).toHaveBeenCalledTimes(3);

    expect(handleShortcutKey(actions, press("?"), idle)).toBe(false);
    expect(handleShortcutKey(actions, press("f", { ctrlKey: true }), idle)).toBe(false);
    expect(handleShortcutKey(actions, press("k", { ctrlKey: true, shiftKey: true }), idle)).toBe(false);

    for (const guard of [typing, dialog, menu]) {
      expect(handleShortcutKey(actions, press("c", { ctrlKey: true }), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("a", { ctrlKey: true }), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("Delete"), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("Backspace"), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("/"), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("f"), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("Escape"), guard)).toBe(false);
      expect(handleShortcutKey(actions, press("k", { metaKey: true }), guard)).toBe(false);
    }
    expect(copy).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(openNodeSearch).toHaveBeenCalledTimes(2);
    expect(fitView).toHaveBeenCalledTimes(3);
    expect(deselect).toHaveBeenCalledTimes(1);

    const save = vi.fn();
    const guarded = editorActions(handlers({ save }));
    expect(handleShortcutKey(guarded, press("s", { ctrlKey: true }), typing)).toBe(true);
    expect(handleShortcutKey(guarded, press("s", { ctrlKey: true }), dialog)).toBe(true);
    expect(handleShortcutKey(guarded, press("s", { ctrlKey: true }), menu)).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("leaves ctrl+c to the browser when text outside the canvas is selected", () => {
    const copy = vi.fn();
    const paste = vi.fn();
    const fitView = vi.fn();
    const actions = editorActions(handlers({ copy, paste, fitView }));
    const outside = { typing: false, dialogOpen: false, textSelectionOutsideCanvas: true };
    const inside = { typing: false, dialogOpen: false, textSelectionOutsideCanvas: false };

    expect(handleShortcutKey(actions, press("c", { ctrlKey: true }), outside)).toBe(false);
    expect(handleShortcutKey(actions, press("c", { metaKey: true }), outside)).toBe(false);
    expect(copy).not.toHaveBeenCalled();
    expect(handleShortcutKey(actions, press("v", { ctrlKey: true }), outside)).toBe(true);
    expect(handleShortcutKey(actions, press("f"), outside)).toBe(true);
    expect(paste).toHaveBeenCalledTimes(1);
    expect(fitView).toHaveBeenCalledTimes(1);

    const disabled = editorActions(handlers({ copy, canCopy: () => false }));
    expect(handleShortcutKey(disabled, press("c", { ctrlKey: true }), outside)).toBe(false);
    expect(handleShortcutKey(disabled, press("c", { ctrlKey: true }), inside)).toBe(true);
    expect(copy).not.toHaveBeenCalled();

    expect(handleShortcutKey(actions, press("c", { ctrlKey: true }), inside)).toBe(true);
    expect(handleShortcutKey(actions, press("c", { ctrlKey: true }), { typing: true, dialogOpen: false, textSelectionOutsideCanvas: true })).toBe(false);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("consumes copy, paste, delete, and fit when they have nothing to do", () => {
    const copy = vi.fn();
    const paste = vi.fn();
    const remove = vi.fn();
    const fitView = vi.fn();
    const actions = editorActions(
      handlers({
        copy,
        paste,
        delete: remove,
        fitView,
        canCopy: () => false,
        canPaste: () => false,
        canDelete: () => false,
        canFitView: () => false,
      }),
    );
    const idle = { typing: false, dialogOpen: false };
    expect(handleShortcutKey(actions, press("c", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("v", { ctrlKey: true }), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("Delete"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("Backspace"), idle)).toBe(true);
    expect(handleShortcutKey(actions, press("f"), idle)).toBe(true);
    expect(copy).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });
});
