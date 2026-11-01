import { nextCellId } from "./cells";
import {
  interpretNotebookKey,
  type NotebookCommand,
  type NotebookKeyEvent,
  type NotebookMode,
} from "./keyboard";
import type { NotebookCell, NotebookDoc } from "./types";

export interface NotebookSurface {
  cells: NotebookCell[];
  selectedId: string;
  mode: NotebookMode;
  deleteArmed: boolean;
}

export interface NotebookDispatch {
  surface: NotebookSurface;
  /** The browser default (newline, tab, or a typed letter) should not run. */
  handled: boolean;
  changed: boolean;
  /** Focus the selected cell after this dispatch. */
  focus: boolean;
  /**
   * Shift+Enter / Ctrl+Enter. Persist first when the draft is dirty or this
   * dispatch created a cell, then execute `run` when the cell is code.
   */
  save: boolean;
  /** Execute this cell once the notebook has been saved. Markdown renders locally. */
  run?: { cellId: string; advance: boolean };
}

export function notebookDraftKey(
  doc: Pick<NotebookDoc, "cells" | "name" | "description" | "kernel">,
): string {
  return JSON.stringify([doc.name, doc.description, doc.kernel, doc.cells]);
}

export function insertCellAt(
  cells: readonly NotebookCell[],
  selectedId: string,
  place: "above" | "below",
  cell: NotebookCell,
): NotebookCell[] {
  const index = cells.findIndex((item) => item.id === selectedId);
  const at = index < 0 ? cells.length : place === "above" ? index : index + 1;
  return [...cells.slice(0, at), cell, ...cells.slice(at)];
}

export function removeCell(
  cells: readonly NotebookCell[],
  selectedId: string,
): { cells: NotebookCell[]; selectedId: string } | null {
  if (cells.length <= 1) return null;
  const index = cells.findIndex((item) => item.id === selectedId);
  if (index < 0) return null;
  const next = cells.filter((item) => item.id !== selectedId);
  const selected = next[Math.min(index, next.length - 1)];
  if (!selected) return null;
  return { cells: next, selectedId: selected.id };
}

export function moveSelection(cells: readonly { id: string }[], id: string, delta: -1 | 1): string {
  const index = cells.findIndex((cell) => cell.id === id);
  if (index < 0) return id;
  const next = index + delta;
  if (next < 0 || next >= cells.length) return id;
  return cells[next]?.id ?? id;
}

/** Shift+Enter moves to the next cell and creates a code cell when this is the last one. */
export function selectAfterRun(
  cells: readonly NotebookCell[],
  id: string,
  advance: boolean,
  create: () => NotebookCell,
): { cells: NotebookCell[]; selectedId: string; created: boolean } {
  if (!advance) return { cells: [...cells], selectedId: id, created: false };
  const following = nextCellId(cells, id);
  if (following) return { cells: [...cells], selectedId: following, created: false };
  const index = cells.findIndex((cell) => cell.id === id);
  if (index < 0) return { cells: [...cells], selectedId: id, created: false };
  const cell = create();
  return {
    cells: [...cells.slice(0, index + 1), cell, ...cells.slice(index + 1)],
    selectedId: cell.id,
    created: true,
  };
}

function applyCommand(
  surface: NotebookSurface,
  cellId: string,
  command: NotebookCommand,
  create: () => NotebookCell,
  readOnly: boolean,
): NotebookDispatch {
  const stay: NotebookDispatch = {
    surface: { ...surface, selectedId: cellId, deleteArmed: false },
    handled: true,
    changed: false,
    focus: false,
    save: false,
  };
  if (readOnly && command.type !== "move") return stay;
  const cells = surface.cells;
  const cell = cells.find((item) => item.id === cellId);

  if (command.type === "move") {
    return {
      surface: {
        ...surface,
        selectedId: moveSelection(cells, cellId, command.delta),
        mode: "command",
        deleteArmed: false,
      },
      handled: true,
      changed: false,
      focus: true,
      save: false,
    };
  }

  if (command.type === "command") {
    return {
      surface: { ...surface, selectedId: cellId, mode: "command", deleteArmed: false },
      handled: true,
      changed: false,
      focus: true,
      save: false,
    };
  }

  if (command.type === "edit") {
    return {
      surface: { ...surface, selectedId: cellId, mode: "edit", deleteArmed: false },
      handled: true,
      changed: false,
      focus: true,
      save: false,
    };
  }

  if (!cell) return stay;

  if (command.type === "insert") {
    const created = create();
    return {
      surface: {
        cells: insertCellAt(cells, cellId, command.place, created),
        selectedId: created.id,
        mode: "command",
        deleteArmed: false,
      },
      handled: true,
      changed: true,
      focus: true,
      save: false,
    };
  }

  if (command.type === "delete") {
    const removed = removeCell(cells, cellId);
    if (!removed) return stay;
    return {
      surface: { ...removed, mode: "command", deleteArmed: false },
      handled: true,
      changed: true,
      focus: true,
      save: false,
    };
  }

  if (command.type === "role") {
    if (cell.role === command.role) {
      return {
        surface: { ...surface, selectedId: cellId, mode: "command", deleteArmed: false },
        handled: true,
        changed: false,
        focus: true,
        save: false,
      };
    }
    return {
      surface: {
        cells: cells.map((item) => (item.id === cellId ? { ...item, role: command.role } : item)),
        selectedId: cellId,
        mode: "command",
        deleteArmed: false,
      },
      handled: true,
      changed: true,
      focus: true,
      save: false,
    };
  }

  const advanced = selectAfterRun(cells, cellId, command.advance, () => {
    const created = create();
    return { ...created, role: "code", source: "" };
  });
  return {
    surface: {
      cells: advanced.cells,
      selectedId: advanced.selectedId,
      mode: "command",
      deleteArmed: false,
    },
    handled: true,
    changed: advanced.created,
    focus: true,
    save: true,
    run: cell.role === "markdown" ? undefined : { cellId, advance: command.advance },
  };
}

export function dispatchNotebookKey(
  surface: NotebookSurface,
  cellId: string,
  origin: NotebookMode,
  event: NotebookKeyEvent,
  create: () => NotebookCell,
  readOnly: boolean,
): NotebookDispatch {
  const outcome = interpretNotebookKey(origin, event, surface.deleteArmed);
  if (!outcome.command) {
    const armedChanged = outcome.deleteArmed !== surface.deleteArmed;
    return {
      surface: { ...surface, selectedId: cellId, deleteArmed: outcome.deleteArmed },
      handled: origin === "command" && armedChanged,
      changed: false,
      focus: false,
      save: false,
    };
  }
  return applyCommand(
    { ...surface, selectedId: cellId, deleteArmed: false },
    cellId,
    outcome.command,
    create,
    readOnly,
  );
}
