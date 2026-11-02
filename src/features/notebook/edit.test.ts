import { describe, expect, it } from "vitest";

import { dispatchNotebookKey, dragOffsets, gapAtPointer, moveCellToGap, notebookDraftKey, type NotebookSurface } from "./edit";
import type { NotebookCell } from "./types";

const cells: NotebookCell[] = [
  { id: "c1", role: "code", source: "print(1)\n" },
  { id: "c2", role: "markdown", source: "说明\n" },
];

function surface(partial: Partial<NotebookSurface> = {}): NotebookSurface {
  return {
    cells,
    selectedId: "c1",
    mode: "command",
    deleteArmed: false,
    ...partial,
  };
}

function createIds(): () => NotebookCell {
  let serial = 0;
  return () => {
    serial += 1;
    return { id: `n${serial}`, role: "code", source: "" };
  };
}

describe("dispatchNotebookKey", () => {
  it("Shift+Enter saves a run, moves on, and creates a cell at the end", () => {
    const create = createIds();
    const advance = dispatchNotebookKey(surface(), "c1", "edit", { key: "Enter", shiftKey: true }, create, false);
    expect(advance.save).toBe(true);
    expect(advance.run).toEqual({ cellId: "c1", advance: true });
    expect(advance.surface.selectedId).toBe("c2");
    expect(advance.surface.mode).toBe("command");
    expect(advance.changed).toBe(false);

    const created = dispatchNotebookKey(surface({ selectedId: "c2" }), "c2", "edit", { key: "Enter", shiftKey: true }, create, false);
    expect(created.changed).toBe(true);
    expect(created.surface.cells.map((cell) => cell.id)).toEqual(["c1", "c2", "n1"]);
    expect(created.surface.selectedId).toBe("n1");
    expect(created.surface.cells[2]).toMatchObject({ role: "code", source: "" });
    expect(created.run).toBeUndefined();
  });

  it("Ctrl+Enter runs the code cell and stays there", () => {
    const stay = dispatchNotebookKey(surface(), "c1", "edit", { key: "Enter", ctrlKey: true }, createIds(), false);
    expect(stay.run).toEqual({ cellId: "c1", advance: false });
    expect(stay.surface.selectedId).toBe("c1");
    expect(stay.surface.mode).toBe("command");
    expect(stay.changed).toBe(false);
  });

  it("inserts above and below, deletes with DD, and switches M/Y in command mode", () => {
    const create = createIds();
    const below = dispatchNotebookKey(surface(), "c1", "command", { key: "b" }, create, false);
    expect(below.surface.cells.map((cell) => cell.id)).toEqual(["c1", "n1", "c2"]);
    expect(below.surface.selectedId).toBe("n1");
    expect(below.surface.mode).toBe("command");

    const above = dispatchNotebookKey(surface(), "c1", "command", { key: "a" }, create, false);
    expect(above.surface.cells.map((cell) => cell.id)).toEqual(["n2", "c1", "c2"]);

    const armed = dispatchNotebookKey(surface(), "c2", "command", { key: "d" }, create, false);
    expect(armed.handled).toBe(true);
    expect(armed.surface.deleteArmed).toBe(true);
    expect(armed.changed).toBe(false);

    const removed = dispatchNotebookKey(armed.surface, "c2", "command", { key: "d" }, create, false);
    expect(removed.surface.cells.map((cell) => cell.id)).toEqual(["c1"]);
    expect(removed.surface.selectedId).toBe("c1");

    const markdown = dispatchNotebookKey(surface(), "c1", "command", { key: "m" }, create, false);
    expect(markdown.surface.cells[0]?.role).toBe("markdown");
    const code = dispatchNotebookKey(surface({ selectedId: "c2" }), "c2", "command", { key: "y" }, create, false);
    expect(code.surface.cells[1]?.role).toBe("code");
  });

  it("keeps the last cell and ignores structural keys while read-only", () => {
    const create = createIds();
    const only = dispatchNotebookKey(surface({ cells: [cells[0]!] }), "c1", "command", { key: "d" }, create, false);
    const kept = dispatchNotebookKey({ ...only.surface, deleteArmed: true }, "c1", "command", { key: "d" }, create, false);
    expect(kept.changed).toBe(false);
    expect(kept.surface.cells).toHaveLength(1);

    const readOnly = dispatchNotebookKey(surface(), "c1", "command", { key: "a" }, create, true);
    expect(readOnly.changed).toBe(false);
    expect(readOnly.surface.cells).toHaveLength(2);
    expect(readOnly.handled).toBe(true);
  });

  it("enters edit mode and does not treat typed letters as commands", () => {
    const edit = dispatchNotebookKey(surface(), "c1", "command", { key: "Enter" }, createIds(), false);
    expect(edit.surface.mode).toBe("edit");
    expect(edit.focus).toBe(true);
    const typed = dispatchNotebookKey(edit.surface, "c1", "edit", { key: "a" }, createIds(), false);
    expect(typed.handled).toBe(false);
    expect(typed.changed).toBe(false);
  });
});

describe("notebookDraftKey", () => {
  it("changes when cells, the name, the description, or the kernel change", () => {
    const doc = { name: "qc", description: "检查", kernel: "py311-pandas", cells };
    expect(notebookDraftKey(doc)).toBe(notebookDraftKey({ ...doc, cells: [...cells] }));
    expect(notebookDraftKey(doc)).not.toBe(notebookDraftKey({ ...doc, name: "qc2" }));
    expect(notebookDraftKey(doc)).not.toBe(notebookDraftKey({
      ...doc,
      cells: [{ ...cells[0]!, source: "print(2)\n" }, cells[1]!],
    }));
  });
});

describe("moveCellToGap", () => {
  const ids = (cells: { id: string }[] | null) => cells?.map((cell) => cell.id) ?? null;
  const cells = ["a", "b", "c", "d"].map((id) => ({ id }));

  it("moves a cell down into a later gap", () => {
    expect(ids(moveCellToGap(cells, "a", 3))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveCellToGap(cells, "b", 4))).toEqual(["a", "c", "d", "b"]);
  });

  it("moves a cell up into an earlier gap", () => {
    expect(ids(moveCellToGap(cells, "d", 0))).toEqual(["d", "a", "b", "c"]);
    expect(ids(moveCellToGap(cells, "c", 1))).toEqual(["a", "c", "b", "d"]);
  });

  it("ignores drops next to the cell itself and unknown cells", () => {
    expect(moveCellToGap(cells, "b", 1)).toBeNull();
    expect(moveCellToGap(cells, "b", 2)).toBeNull();
    expect(moveCellToGap(cells, "x", 0)).toBeNull();
    expect(moveCellToGap(cells, "a", 5)).toBeNull();
  });
});

describe("gapAtPointer", () => {
  const midpoints = [100, 300, 500];

  it("counts the cell midpoints above the pointer", () => {
    expect(gapAtPointer(midpoints, 0)).toBe(0);
    expect(gapAtPointer(midpoints, 150)).toBe(1);
    expect(gapAtPointer(midpoints, 499)).toBe(2);
    expect(gapAtPointer(midpoints, 900)).toBe(3);
  });

  it("returns 0 for an empty notebook", () => {
    expect(gapAtPointer([], 50)).toBe(0);
  });
});

describe("dragOffsets", () => {
  const pitches = [100, 50, 80, 60];

  it("slides the passed cells up and the dragged one down", () => {
    expect(dragOffsets(pitches, 0, 3)).toEqual([130, -100, -100, 0]);
  });

  it("slides the passed cells down and the dragged one up", () => {
    expect(dragOffsets(pitches, 3, 1)).toEqual([0, 60, 60, -130]);
  });

  it("stays put before the pointer picks a gap or when the gap is beside the cell", () => {
    expect(dragOffsets(pitches, 1, null)).toEqual([0, 0, 0, 0]);
    expect(dragOffsets(pitches, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(dragOffsets(pitches, 1, 2)).toEqual([0, 0, 0, 0]);
  });
});
