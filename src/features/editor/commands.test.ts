import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { combosOf, handleShortcutKey, shortcutHint, type KeyEvent } from "@/lib/actions";
import { ASSISTANT_PROMPT } from "@/features/assistant/prompt";
import { EDITOR_ACTIONS, editorActions } from "./commands";

const readme = readFileSync(fileURLToPath(new URL("../../../README.md", import.meta.url)), "utf8");

function press(key: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { key, ...mods };
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
  });

  it("saves while typing or in a dialog, and keeps undo and redo off both", () => {
    const save = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    const actions = editorActions({ save, undo, redo, canUndo: () => true, canRedo: () => true });
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
    const actions = editorActions({
      save: () => {},
      undo,
      redo,
      canUndo: () => false,
      canRedo: () => false,
    });
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
    expect(ASSISTANT_PROMPT).toContain(shortcutHint(EDITOR_ACTIONS.undo.shortcut));
  });
});
