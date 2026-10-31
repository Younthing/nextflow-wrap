import type { Action, KeyCombo } from "@/lib/actions";

type CommandSpec = {
  id: string;
  label: string;
  shortcut: KeyCombo | readonly [KeyCombo, ...KeyCombo[]];
  allowWhileTyping?: boolean;
  allowWhileDialog?: boolean;
};

/**
 * Editor commands. Save, undo, and redo keep ComfyUI's ids and chords.
 * Canvas commands use ComfyUI's ids where those commands exist
 * (`Comfy.Canvas.CopySelected`, `PasteFromClipboard`, `SelectAll`, `FitView`).
 * Duplicate, deselect, and node search are this editor's chords; U3 renders
 * the same actions in the canvas context menu.
 * Labels stay the ones the toolbar and help text show.
 */
export const EDITOR_ACTIONS: {
  save: CommandSpec;
  undo: CommandSpec;
  redo: CommandSpec;
  copy: CommandSpec;
  paste: CommandSpec;
  duplicate: CommandSpec;
  selectAll: CommandSpec;
  deselect: CommandSpec;
  search: CommandSpec;
  fit: CommandSpec;
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
  copy: {
    id: "Comfy.Canvas.CopySelected",
    label: "复制",
    shortcut: { key: "c", ctrl: true },
  },
  paste: {
    id: "Comfy.Canvas.PasteFromClipboard",
    label: "粘贴",
    shortcut: { key: "v", ctrl: true },
  },
  duplicate: {
    id: "Comfy.Canvas.DuplicateSelected",
    label: "创建副本",
    shortcut: { key: "d", ctrl: true },
  },
  selectAll: {
    id: "Comfy.Canvas.SelectAll",
    label: "全选",
    shortcut: { key: "a", ctrl: true },
  },
  deselect: {
    id: "Comfy.Canvas.Deselect",
    label: "取消选择",
    shortcut: { key: "Escape" },
  },
  search: {
    id: "Comfy.Canvas.ShowNodeSearch",
    label: "搜索节点",
    // The toolbar and empty-canvas hint show Ctrl/⌘+K. `/` still opens the same dialog.
    shortcut: [
      { key: "k", ctrl: true },
      { key: "/" },
    ],
  },
  fit: {
    id: "Comfy.Canvas.FitView",
    label: "适应视图",
    // ComfyUI's default is `.` (fit selection, or the whole graph). This editor uses F and Shift+1.
    shortcut: [
      { key: "f" },
      { key: "1", shift: true },
    ],
  },
};

export type EditorCommandHandlers = {
  save: () => void;
  undo: () => void;
  redo: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  selectAll: () => void;
  deselect: () => void;
  openNodeSearch: () => void;
  fitView: () => void;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
  canCopy?: () => boolean;
  canPaste?: () => boolean;
  canDuplicate?: () => boolean;
  canSelectAll?: () => boolean;
  canDeselect?: () => boolean;
  canFitView?: () => boolean;
};

export function editorActions(handlers: EditorCommandHandlers): Action[] {
  return [
    { ...EDITOR_ACTIONS.save, run: handlers.save },
    { ...EDITOR_ACTIONS.undo, enabled: handlers.canUndo, run: handlers.undo },
    { ...EDITOR_ACTIONS.redo, enabled: handlers.canRedo, run: handlers.redo },
    { ...EDITOR_ACTIONS.copy, enabled: handlers.canCopy, run: handlers.copy },
    { ...EDITOR_ACTIONS.paste, enabled: handlers.canPaste, run: handlers.paste },
    { ...EDITOR_ACTIONS.duplicate, enabled: handlers.canDuplicate, run: handlers.duplicate },
    { ...EDITOR_ACTIONS.selectAll, enabled: handlers.canSelectAll, run: handlers.selectAll },
    { ...EDITOR_ACTIONS.deselect, enabled: handlers.canDeselect, run: handlers.deselect },
    { ...EDITOR_ACTIONS.search, run: handlers.openNodeSearch },
    { ...EDITOR_ACTIONS.fit, enabled: handlers.canFitView, run: handlers.fitView },
  ];
}
