import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOTEBOOK_OUTPUT_LIMIT,
  createNotebookActions,
  describeCellOutput,
  runCellBlockers,
  runCellConfirmView,
  type NotebookDocumentApi,
} from "./assistant-actions";
import { simulateCells } from "./simulate";
import { fixtureNotebooks } from "./test-fixtures";
import type { CellRunResult, NotebookCell, NotebookDoc, NotebookRunResult } from "./types";

function fixture(id: string): NotebookDoc {
  const doc = fixtureNotebooks(0).find((item) => item.id === id);
  if (!doc) throw new Error(`no fixture ${id}`);
  return doc;
}

/** The session's document API over plain state, with the demo runner standing in for the kernel. */
function fakeEditor(initial: NotebookDoc) {
  const state = {
    doc: initial,
    outputs: {} as Record<string, CellRunResult>,
    busy: false,
    selected: undefined as string | undefined,
    saves: 0,
  };
  const run = vi.fn(async (cellId: string): Promise<NotebookRunResult> => {
    state.saves += 1;
    const cells = simulateCells(state.doc, cellId);
    for (const cell of cells) state.outputs[cell.id] = cell;
    return { cells, kernel: { mode: "jupyter", kernel: "python3" } };
  });
  const commands: NotebookDocumentApi = {
    read: () => ({ doc: state.doc, outputs: state.outputs, busy: state.busy }),
    setCells: (cells: NotebookCell[], select?: string) => {
      state.doc = { ...state.doc, cells };
      state.selected = select;
    },
    runCell: run,
  };
  let serial = 0;
  const actions = createNotebookActions(commands, (role, source = "") => {
    serial += 1;
    return { id: `new${serial}`, role, source };
  });
  return { state, commands, actions, run };
}

let editor: ReturnType<typeof fakeEditor>;
beforeEach(() => {
  editor = fakeEditor(fixture("qc_summary"));
});

describe("get_notebook_summary", () => {
  it("lists ids, kinds, previews, and output flags", () => {
    editor.state.outputs.c2 = { id: "c2", stdout: "", error: "NameError: rows", outputs: [{ outputType: "error", traceback: "NameError: rows" }] };
    const summary = editor.actions.summary();
    expect(summary).toMatchObject({ notebookId: "qc_summary", language: "python", busy: false });
    expect(summary.cells.map((cell) => [cell.id, cell.kind])).toEqual([
      ["c1", "input"],
      ["c2", "code"],
      ["c3", "explore"],
      ["c4", "output"],
    ]);
    const c2 = summary.cells.find((cell) => cell.id === "c2");
    expect(c2).toMatchObject({ index: 1, hasOutput: true, hasError: true });
    expect(c2?.preview.split("\n").length).toBeLessThanOrEqual(4);
    expect(summary.cells.find((cell) => cell.id === "c1")).toMatchObject({ hasOutput: false });
    expect(summary.cells[0]).not.toHaveProperty("hasError");
  });
});

describe("edit_notebook_cell", () => {
  it("inserts after a cell, at the top, and at the bottom", () => {
    expect(editor.actions.editCell({ editType: "insert", cellId: "c2", source: "print(rows)\n" })).toEqual({ inserted: "new1", index: 2, kind: "code" });
    expect(editor.actions.editCell({ editType: "insert", cellId: "TOP", kind: "markdown", source: "# QC" })).toMatchObject({ inserted: "new2", index: 0, kind: "markdown" });
    const bottom = editor.actions.editCell({ editType: "insert" });
    const ids = editor.state.doc.cells.map((cell) => cell.id);
    expect(ids[0]).toBe("new2");
    expect(ids[ids.indexOf("c2") + 1]).toBe("new1");
    expect(ids.at(-1)).toBe("new3");
    expect(bottom).toMatchObject({ inserted: "new3", index: ids.length - 1 });
    expect(editor.state.selected).toBe("new3");
  });

  it("edits source and kind, and deletes a cell", () => {
    expect(editor.actions.editCell({ editType: "edit", cellId: "c3", kind: "code" })).toMatchObject({ edited: "c3", kind: "code" });
    editor.actions.editCell({ editType: "edit", cellId: "c2", source: "rows = []\n" });
    const c2 = editor.state.doc.cells.find((cell) => cell.id === "c2");
    expect(c2).toEqual({ id: "c2", role: "code", source: "rows = []\n" });
    expect(editor.state.doc.cells.find((cell) => cell.id === "c3")?.role).toBe("code");

    const before = editor.state.doc.cells.length;
    expect(editor.actions.editCell({ editType: "delete", cellId: "c3" })).toEqual({ deleted: "c3", remaining: before - 1 });
    expect(editor.state.doc.cells.some((cell) => cell.id === "c3")).toBe(false);
  });

  it("explains a bad call instead of guessing", () => {
    expect(() => editor.actions.editCell({ editType: "edit", cellId: "nope", source: "x" })).toThrow(/找不到单元格 nope/);
    expect(() => editor.actions.editCell({ editType: "edit", cellId: "c2" })).toThrow(/source 或 kind/);
    expect(() => editor.actions.editCell({ editType: "delete" })).toThrow(/需要 cellId/);
    expect(() => editor.actions.editCell({ editType: "insert", kind: "shell" as never })).toThrow(/单元格类型只能是/);
    const single = fakeEditor(fixture("hello_py"));
    single.commands.setCells([{ id: "only", role: "code", source: "" }]);
    expect(() => single.actions.editCell({ editType: "delete", cellId: "only" })).toThrow(/至少要保留一个单元格/);
  });
});

describe("run_notebook_cell", () => {
  it("runs one cell through the editor and returns its output", async () => {
    const result = await editor.actions.runCell("c2");
    expect(editor.run).toHaveBeenCalledWith("c2");
    expect(result).toMatchObject({
      accepted: true,
      cellId: "c2",
      status: "ok",
      stdout: "（演示模式未执行内核）\n",
      message: "单元格已运行",
    });
    expect(editor.state.outputs.c2).toBeDefined();
  });

  it("refuses markdown, a missing cell, and a busy notebook without calling the kernel", async () => {
    editor.actions.editCell({ editType: "insert", cellId: "TOP", kind: "markdown", source: "说明" });
    expect(runCellBlockers(editor.commands.read(), "new1")).toEqual(["说明单元格不能运行，选一个代码单元格。"]);
    await expect(editor.actions.runCell("new1")).rejects.toThrow(/说明单元格不能运行/);
    expect(runCellBlockers(editor.commands.read(), "nope")).toEqual(["找不到单元格 nope。"]);
    editor.state.busy = true;
    await expect(editor.actions.runCell("c2")).rejects.toThrow(/正在运行/);
    expect(editor.run).not.toHaveBeenCalled();
  });

  it("prepares the confirm, and refuses at accept time when the cell's source changed", async () => {
    const prepared = editor.actions.prepareRunCell("c2", "验证");
    expect(prepared.view).toMatchObject({ title: "运行单元格", hint: "验证" });
    expect(prepared.problems()).toEqual([]);
    editor.actions.editCell({ editType: "edit", cellId: "c2", source: "rows = 1\n" });
    expect(prepared.problems()).toEqual(["确认时单元格内容已变化，没有运行。请再试一次。"]);
    expect(editor.run).not.toHaveBeenCalled();

    const fresh = editor.actions.prepareRunCell("c2");
    await expect(fresh.invoke()).resolves.toMatchObject({ accepted: true, cellId: "c2" });
    expect(editor.actions.prepareRunCell("nope").view.type).toBe("info");
  });

  it("asks before running, and the confirm names the cell and kernel", () => {
    const python = runCellConfirmView(editor.state.doc, "c2", [], "验证修复");
    expect(python).toMatchObject({ title: "运行单元格", type: "default", hint: "验证修复", problems: [] });
    expect(python.message).toMatch(/单元格 2/);
    expect(python.message).toMatch(/常驻内核/);
    expect(python.itemList[0]).toContain("import os");

    const r = fixture("deseq2_plot");
    expect(runCellConfirmView(r, r.cells[0]!.id, []).message).toMatch(/从第一格运行/);
    expect(runCellConfirmView(r, "nope", ["找不到单元格 nope。"]).type).toBe("info");
  });
});

describe("read_cell_output", () => {
  it("reads streams, errors, and text results, clipped for the model", () => {
    expect(editor.actions.readOutput("c2")).toMatchObject({ cellId: "c2", hasOutput: false });
    editor.state.outputs.c2 = {
      id: "c2",
      stdout: "",
      executionCount: 3,
      outputs: [
        { outputType: "stream", name: "stdout", text: "x".repeat(NOTEBOOK_OUTPUT_LIMIT + 50) },
        { outputType: "stream", name: "stderr", text: "warn\n" },
        { outputType: "execute_result", data: { "text/plain": "   sample  mean_q", "text/html": "<table/>" } },
        { outputType: "display_data", data: { "image/png": "iVBOR" } },
      ],
    };
    const view = editor.actions.readOutput("c2");
    expect(view).toMatchObject({ hasOutput: true, cellId: "c2", status: "ok", executionCount: 3, stderr: "warn\n" });
    expect("stdout" in view && view.stdout?.length).toBeLessThan(NOTEBOOK_OUTPUT_LIMIT + 50);
    expect("stdout" in view && view.stdout).toMatch(/已截断/);
    expect("results" in view && view.results).toEqual([
      { mime: ["text/plain", "text/html"], text: "   sample  mean_q" },
      { mime: ["image/png"] },
    ]);
    expect(() => editor.actions.readOutput("nope")).toThrow(/找不到单元格/);
  });

  it("treats a legacy stdout/error pair like rich output", () => {
    expect(describeCellOutput({ id: "c9", stdout: "hi\n", error: "Traceback: boom" })).toEqual({
      cellId: "c9",
      status: "error",
      stdout: "hi\n",
      error: "Traceback: boom",
    });
  });
});
