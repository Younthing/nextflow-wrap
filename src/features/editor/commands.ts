import type { Action, KeyCombo } from "@/lib/actions";

type CommandSpec = {
  id: string;
  label: string;
  shortcut: KeyCombo | readonly [KeyCombo, ...KeyCombo[]];
  allowWhileTyping?: boolean;
  allowWhileDialog?: boolean;
};

/**
 * Editor commands that already exist. Ids and chords match ComfyUI
 * (`Comfy.SaveWorkflow`, `Comfy.Undo`, `Comfy.Redo`) so later canvas
 * commands can use the same ids (`Comfy.Canvas.DeleteSelectedItems`, …).
 * Labels stay the ones the toolbar already shows.
 */
export const EDITOR_ACTIONS: {
  save: CommandSpec;
  undo: CommandSpec;
  redo: CommandSpec;
} = {
  save: {
    id: "Comfy.SaveWorkflow",
    label: "保存",
    shortcut: { key: "s", ctrl: true },
    allowWhileTyping: true,
    allowWhileDialog: true,
  },
  undo: {
    id: "Comfy.Undo",
    label: "撤销",
    shortcut: { key: "z", ctrl: true },
  },
  redo: {
    id: "Comfy.Redo",
    label: "重做",
    // changeTracker accepts Ctrl+Y and Ctrl+Shift+Z. The toolbar shows the Shift chord.
    shortcut: [
      { key: "z", ctrl: true, shift: true },
      { key: "y", ctrl: true },
    ],
  },
};

export type EditorCommandHandlers = {
  save: () => void;
  undo: () => void;
  redo: () => void;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
};

export function editorActions(handlers: EditorCommandHandlers): Action[] {
  return [
    { ...EDITOR_ACTIONS.save, run: handlers.save },
    { ...EDITOR_ACTIONS.undo, enabled: handlers.canUndo, run: handlers.undo },
    { ...EDITOR_ACTIONS.redo, enabled: handlers.canRedo, run: handlers.redo },
  ];
}
