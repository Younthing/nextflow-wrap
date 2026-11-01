import { describe, expect, it } from "vitest";

import { interpretNotebookKey, type NotebookKeyEvent } from "./keyboard";

function key(partial: Partial<NotebookKeyEvent> & { key: string }): NotebookKeyEvent {
  return partial;
}

describe("interpretNotebookKey", () => {
  it("runs with Shift+Enter and stays with Ctrl or Command+Enter in edit mode", () => {
    expect(interpretNotebookKey("edit", key({ key: "Enter", shiftKey: true }), false)).toEqual({
      command: { type: "run", advance: true },
      deleteArmed: false,
    });
    expect(interpretNotebookKey("edit", key({ key: "Enter", ctrlKey: true }), false).command).toEqual({
      type: "run",
      advance: false,
    });
    expect(interpretNotebookKey("edit", key({ key: "Enter", metaKey: true }), false).command).toEqual({
      type: "run",
      advance: false,
    });
  });

  it("leaves letters and plain Enter to the editor", () => {
    expect(interpretNotebookKey("edit", key({ key: "a" }), false)).toEqual({
      command: null,
      deleteArmed: false,
    });
    expect(interpretNotebookKey("edit", key({ key: "Enter" }), false).command).toBeNull();
    expect(interpretNotebookKey("edit", key({ key: "Escape" }), true)).toEqual({
      command: { type: "command" },
      deleteArmed: false,
    });
  });

  it("inserts, deletes, and switches type only in command mode", () => {
    expect(interpretNotebookKey("command", key({ key: "a" }), false).command).toEqual({ type: "insert", place: "above" });
    expect(interpretNotebookKey("command", key({ key: "b" }), false).command).toEqual({ type: "insert", place: "below" });
    expect(interpretNotebookKey("command", key({ key: "m" }), false).command).toEqual({ type: "role", role: "markdown" });
    expect(interpretNotebookKey("command", key({ key: "y" }), false).command).toEqual({ type: "role", role: "code" });
    expect(interpretNotebookKey("command", key({ key: "Enter" }), false).command).toEqual({ type: "edit" });
    expect(interpretNotebookKey("command", key({ key: "d" }), false)).toEqual({ command: null, deleteArmed: true });
    expect(interpretNotebookKey("command", key({ key: "d" }), true).command).toEqual({ type: "delete" });
    expect(interpretNotebookKey("command", key({ key: "a" }), true).command).toEqual({ type: "insert", place: "above" });
  });

  it("runs from command mode and ignores modified letters", () => {
    expect(interpretNotebookKey("command", key({ key: "Enter", shiftKey: true }), true)).toEqual({
      command: { type: "run", advance: true },
      deleteArmed: false,
    });
    expect(interpretNotebookKey("command", key({ key: "a", ctrlKey: true }), false).command).toBeNull();
    expect(interpretNotebookKey("command", key({ key: "A", shiftKey: true }), false).command).toBeNull();
  });

  it("ignores chords while an IME composition is open", () => {
    expect(interpretNotebookKey("edit", key({ key: "Enter", shiftKey: true, composing: true }), false)).toEqual({
      command: null,
      deleteArmed: false,
    });
  });
});
