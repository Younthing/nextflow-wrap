export type NotebookMode = "edit" | "command";

export interface NotebookKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  composing?: boolean;
}

export type NotebookCommand =
  | { type: "run"; advance: boolean }
  | { type: "insert"; place: "above" | "below" }
  | { type: "delete" }
  | { type: "role"; role: "code" | "markdown" }
  | { type: "edit" }
  | { type: "command" }
  | { type: "move"; delta: -1 | 1 };

export interface KeyInterpretation {
  command: NotebookCommand | null;
  deleteArmed: boolean;
}

export const COMMAND_HINT = "命令模式 · A 在上方插入 · B 在下方插入 · DD 删除 · M 说明 · Y 代码 · Enter 编辑";
export const EDIT_HINT = "编辑模式 · Shift+Enter 保存、运行并跳到下一格 · Ctrl+Enter 运行并留在此格 · Esc 命令模式";

type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  nativeEvent?: { isComposing?: boolean };
};

export function toNotebookKeyEvent(event: KeyLike): NotebookKeyEvent {
  return {
    key: event.key,
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    altKey: Boolean(event.altKey),
    shiftKey: Boolean(event.shiftKey),
    repeat: Boolean(event.repeat),
    composing: Boolean(event.nativeEvent?.isComposing),
  };
}

/**
 * Jupyter-style chords.
 * Edit mode types letters. Command mode uses A/B, DD, M/Y, and Enter.
 * Shift+Enter and Ctrl/⌘+Enter run in both modes. Esc leaves edit mode.
 */
export function interpretNotebookKey(
  mode: NotebookMode,
  event: NotebookKeyEvent,
  deleteArmed: boolean,
): KeyInterpretation {
  if (event.composing || event.key === "Process") return { command: null, deleteArmed };
  const ctrl = Boolean(event.ctrlKey || event.metaKey);
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);
  const plain = !ctrl && !alt && !shift;
  const key = event.key;
  const lower = key.toLowerCase();

  if (key === "Enter" && !alt && !event.repeat) {
    if (shift && !ctrl) return { command: { type: "run", advance: true }, deleteArmed: false };
    if (ctrl && !shift) return { command: { type: "run", advance: false }, deleteArmed: false };
  }

  if (mode === "edit") {
    if (plain && key === "Escape") return { command: { type: "command" }, deleteArmed: false };
    return { command: null, deleteArmed: false };
  }

  if (event.repeat && key !== "ArrowUp" && key !== "ArrowDown") {
    return { command: null, deleteArmed };
  }

  if (deleteArmed && !(plain && lower === "d")) {
    return interpretNotebookKey(mode, event, false);
  }

  if (plain && lower === "d") {
    if (deleteArmed) return { command: { type: "delete" }, deleteArmed: false };
    return { command: null, deleteArmed: true };
  }

  if (plain && lower === "a") return { command: { type: "insert", place: "above" }, deleteArmed: false };
  if (plain && lower === "b") return { command: { type: "insert", place: "below" }, deleteArmed: false };
  if (plain && lower === "m") return { command: { type: "role", role: "markdown" }, deleteArmed: false };
  if (plain && lower === "y") return { command: { type: "role", role: "code" }, deleteArmed: false };
  if (plain && key === "Enter") return { command: { type: "edit" }, deleteArmed: false };
  if (plain && key === "Escape") return { command: null, deleteArmed: false };
  if (plain && (key === "ArrowDown" || lower === "j")) {
    return { command: { type: "move", delta: 1 }, deleteArmed: false };
  }
  if (plain && (key === "ArrowUp" || lower === "k")) {
    return { command: { type: "move", delta: -1 }, deleteArmed: false };
  }
  return { command: null, deleteArmed: false };
}
