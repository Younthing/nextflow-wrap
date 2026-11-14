import { infoConfirmView, type AcceptedResult, type ConfirmView, type PreparedInvocation } from "@/features/assistant/confirm";
import { insertCellAt, removeCell } from "./edit";
import { segmentsOf } from "./outputs";
import type { NotebookSession, NotebookSnapshot } from "./session";
import type { CellRunResult, NotebookCell, NotebookCellRole, NotebookDoc, NotebookVariables } from "./types";

/*
 * What the notebook assistant can see and do, mirroring VS Code's notebook
 * tools (GetNotebookSummary, EditNotebook, RunNotebookCell, ReadCellOutput) plus the kernel variables Copilot
 * reads from the Jupyter extension.
 * Everything goes through the open {@link NotebookSession}, the same draft,
 * autosave, and run path the editor's buttons use. Failures throw with a message the
 * model can read and correct itself from.
 */

export const NOTEBOOK_CELL_KINDS = ["code", "markdown", "input", "output", "explore"] as const satisfies readonly NotebookCellRole[];

/** Text the model gets back per stream, so a chatty cell cannot flood the turn. */
export const NOTEBOOK_OUTPUT_LIMIT = 4_000;
const PREVIEW_LINES = 3;
const PREVIEW_CHARS = 240;

/** Variables put in the chat context; the rest are one list_notebook_variables call away. */
export const CONTEXT_VARIABLE_LIMIT = 50;

/** The part of the session the tools use: read, replace cells, run one cell, read kernel variables. */
export type NotebookDocumentApi = Pick<NotebookSession, "read" | "setCells" | "runCell" | "refreshVariables" | "readVariable">;

export type NotebookEditType = "insert" | "delete" | "edit";

export interface NotebookEditInput {
  editType: NotebookEditType;
  /** Target for edit/delete. For insert: the cell to insert below, or `TOP` / `BOTTOM`. */
  cellId?: string;
  kind?: NotebookCellRole;
  source?: string;
}

export interface NotebookCellOutputView {
  cellId: string;
  status: "ok" | "error";
  executionCount?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  /** Rich results (tables, images, HTML) by MIME type; the model only gets text/plain. */
  results?: { mime: string[]; text?: string }[];
}

export interface RanNotebookCell extends AcceptedResult, NotebookCellOutputView {
  notebookId: string;
  /** Cells the run executed, including earlier ones for a one-shot (R) run. */
  ranCells: number;
  kernelNote?: string;
}

export function newNotebookCell(role: NotebookCellRole, source = ""): NotebookCell {
  return { id: `c_${Math.random().toString(36).slice(2, 8)}`, role, source };
}

function clip(text: string, limit = NOTEBOOK_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…（已截断，共 ${text.length} 字符）`;
}

function preview(source: string): string {
  const lines = source.split("\n");
  const head = lines.slice(0, PREVIEW_LINES).join("\n");
  const shown = head.length > PREVIEW_CHARS ? `${head.slice(0, PREVIEW_CHARS)}…` : head;
  return lines.length > PREVIEW_LINES && shown === head ? `${shown}\n…` : shown;
}

function isKind(value: unknown): value is NotebookCellRole {
  return typeof value === "string" && (NOTEBOOK_CELL_KINDS as readonly string[]).includes(value);
}

function findCell(doc: NotebookDoc, cellId: string | undefined): { cell: NotebookCell; index: number } {
  const id = cellId?.trim();
  if (!id) throw new Error("需要 cellId。先用 get_notebook_summary 查单元格 id");
  const index = doc.cells.findIndex((cell) => cell.id === id);
  const cell = doc.cells[index];
  if (!cell) throw new Error(`找不到单元格 ${id}。先用 get_notebook_summary 查单元格 id`);
  return { cell, index };
}

/** Text the model can read from one cell's output segments. */
export function describeCellOutput(result: CellRunResult): NotebookCellOutputView {
  const segments = segmentsOf(result);
  const stdout = segments.flatMap((item) => (item.outputType === "stream" && item.name === "stdout" ? [item.text] : [])).join("");
  const stderr = segments.flatMap((item) => (item.outputType === "stream" && item.name === "stderr" ? [item.text] : [])).join("");
  const error = segments.find((item) => item.outputType === "error");
  const results = segments.flatMap((item) => {
    if (item.outputType !== "display_data" && item.outputType !== "execute_result") return [];
    const text = item.data["text/plain"] ?? item.data["text/markdown"] ?? item.data["text/csv"];
    return [{ mime: Object.keys(item.data), ...(text ? { text: clip(text) } : {}) }];
  });
  return {
    cellId: result.id,
    status: error ? "error" : "ok",
    ...(result.executionCount !== undefined && { executionCount: result.executionCount }),
    ...(stdout && { stdout: clip(stdout) }),
    ...(stderr && { stderr: clip(stderr) }),
    ...(error && { error: clip(error.traceback) }),
    ...(results.length > 0 && { results }),
  };
}

/** Why `run_notebook_cell` would refuse this cell right now. Empty means it can run. */
export function runCellBlockers(state: NotebookSnapshot, cellId: string): string[] {
  const cell = state.doc.cells.find((item) => item.id === cellId);
  if (!cell) return [`找不到单元格 ${cellId}。`];
  if (cell.role === "markdown") return ["说明单元格不能运行，选一个代码单元格。"];
  if (state.busy) return ["笔记本正在运行，等它结束再试。"];
  return [];
}

/** The confirm shown before the assistant executes a cell, like VS Code's Run Notebook Cell prompt. */
export function runCellConfirmView(doc: NotebookDoc, cellId: string, problems: string[], reason?: string): ConfirmView {
  const index = doc.cells.findIndex((cell) => cell.id === cellId);
  const label = index >= 0 ? `单元格 ${index + 1}` : cellId;
  if (problems.length) {
    return infoConfirmView("无法运行", `不能运行${label}。`, problems, "用户关闭了确认，没有运行单元格。", reason);
  }
  const source = doc.cells[index]?.source ?? "";
  const oneshot = doc.language !== "python";
  return {
    title: "运行单元格",
    message: oneshot
      ? `将在「${doc.name}」的项目目录里从第一格运行到${label}。点确认之后才会执行。`
      : `将在「${doc.name}」的常驻内核里运行${label}。点确认之后才会执行。`,
    type: "default",
    itemList: [preview(source) || "（空单元格）"],
    hint: reason,
    problems: [],
    declinedMessage: "用户取消了确认，没有运行单元格。",
  };
}

/** Cell list the model plans edits from: ids, kinds, a short preview, and what ran. */
export function notebookSummary({ doc, outputs, busy }: NotebookSnapshot) {
  return {
    notebookId: doc.id,
    name: doc.name,
    language: doc.language,
    kernel: doc.kernel,
    busy,
    cells: doc.cells.map((cell, index) => {
      const output = outputs[cell.id];
      const view = output ? describeCellOutput(output) : undefined;
      return {
        index,
        id: cell.id,
        kind: cell.role,
        lines: cell.source ? cell.source.split("\n").length : 0,
        preview: preview(cell.source),
        hasOutput: !!view,
        ...(view?.status === "error" && { hasError: true }),
        ...(view?.executionCount !== undefined && { executionCount: view.executionCount }),
      };
    }),
  };
}

/**
 * Variable names for the chat context, like the kernel state Copilot attaches to a notebook request, so the
 * model does not guess names. `null` before the first read.
 */
export function notebookVariablesContext(variables: NotebookVariables | null) {
  if (!variables) return null;
  if (!variables.available) return { available: false, reason: variables.reason };
  const shown = variables.variables.slice(0, CONTEXT_VARIABLE_LIMIT);
  return {
    available: true,
    total: variables.total,
    variables: shown.map((item) => `${item.name}: ${item.type}${item.size ? ` (${item.size})` : ""}`),
    ...(variables.total > shown.length && { note: `只列出 ${shown.length} 个，用 list_notebook_variables 看全部` }),
  };
}

export function createNotebookActions(commands: NotebookDocumentApi, makeCell = newNotebookCell) {
  const summary = () => notebookSummary(commands.read());

  function editCell(input: NotebookEditInput) {
    const { doc } = commands.read();
    if (input.kind !== undefined && !isKind(input.kind)) {
      throw new Error(`单元格类型只能是 ${NOTEBOOK_CELL_KINDS.join("、")}`);
    }
    if (input.editType === "insert") {
      const cell = makeCell(input.kind ?? "code", input.source ?? "");
      const anchor = input.cellId?.trim() || "BOTTOM";
      let cells: NotebookCell[];
      if (anchor === "TOP") cells = [cell, ...doc.cells];
      else if (anchor === "BOTTOM") cells = [...doc.cells, cell];
      else cells = insertCellAt(doc.cells, findCell(doc, anchor).cell.id, "below", cell);
      commands.setCells(cells, cell.id);
      return { inserted: cell.id, index: cells.indexOf(cell), kind: cell.role };
    }
    if (input.editType === "delete") {
      const { cell } = findCell(doc, input.cellId);
      const next = removeCell(doc.cells, cell.id);
      if (!next) throw new Error("笔记本至少要保留一个单元格");
      commands.setCells(next.cells, next.selectedId);
      return { deleted: cell.id, remaining: next.cells.length };
    }
    if (input.editType === "edit") {
      const { cell, index } = findCell(doc, input.cellId);
      if (input.source === undefined && input.kind === undefined) throw new Error("edit 需要 source 或 kind");
      const updated: NotebookCell = {
        ...cell,
        ...(input.source !== undefined && { source: input.source }),
        ...(input.kind !== undefined && { role: input.kind }),
      };
      commands.setCells(doc.cells.map((item) => (item.id === cell.id ? updated : item)), cell.id);
      return { edited: cell.id, index, kind: updated.role };
    }
    throw new Error("editType 只能是 insert、delete 或 edit");
  }

  function prepareEditCell(input: NotebookEditInput): PreparedInvocation<AcceptedResult> {
    const { doc } = commands.read();
    const anchor = input.cellId?.trim() || "BOTTOM";
    const target = input.editType === "insert" && (anchor === "TOP" || anchor === "BOTTOM")
      ? undefined
      : findCell(doc, input.cellId);
    if (input.editType === "delete" && doc.cells.length < 2) throw new Error("笔记本至少要保留一个单元格");
    if (input.editType === "edit" && input.source === undefined && input.kind === undefined) {
      throw new Error("edit 需要 source 或 kind");
    }
    const verb = input.editType === "insert" ? "插入" : input.editType === "delete" ? "删除" : "修改";
    const place = target ? `第 ${target.index + 1} 格` : anchor === "TOP" ? "开头" : "末尾";
    const cell = target?.cell;
    const before = input.editType === "insert" ? undefined : cell?.source;
    const after = input.editType === "delete" ? undefined : input.source ?? before ?? "";
    const targetRole = input.kind ?? (input.editType === "insert" ? "code" : cell?.role);
    return {
      view: {
        title: `${verb}单元格`,
        message: `${doc.name} · ${place}${input.editType === "insert" && target ? "之后" : ""}`,
        type: input.editType === "delete" ? "delete" : "default",
        confirmLabel: input.editType === "delete" ? "删除" : "应用修改",
        itemList: targetRole && targetRole !== cell?.role ? [`单元格类型：${targetRole}`] : [],
        problems: [],
        declinedMessage: "已取消，笔记本未修改。",
        ...(before !== after && { preview: { before, after } }),
      },
      problems: () => {
        const latest = commands.read().doc;
        if (latest.id !== doc.id || latest.cells.length !== doc.cells.length || latest.cells.some((item, index) => {
          const original = doc.cells[index];
          return item.id !== original.id || item.role !== original.role || item.source !== original.source;
        })) return ["笔记本已变化，请重新生成预览。"];
        return [];
      },
      invoke: async () => ({
        ...editCell(input),
        notebookId: doc.id,
        accepted: true,
        message: `已${verb}单元格`,
      }),
    };
  }

  /** Runs after the surface's confirm. Re-checks blockers, so a stale accept never runs the wrong cell. */
  async function runCell(cellId: string): Promise<RanNotebookCell> {
    const snapshot = commands.read();
    const problems = runCellBlockers(snapshot, cellId);
    if (problems.length) throw new Error(problems.join("；"));
    const result = await commands.runCell(cellId);
    const own = result.cells.find((cell) => cell.id === cellId);
    const view = own ? describeCellOutput(own) : { cellId, status: "ok" as const };
    const failed = result.cells.find((cell) => cell.id !== cellId && describeCellOutput(cell).status === "error");
    return {
      accepted: true,
      notebookId: snapshot.doc.id,
      ...view,
      ranCells: result.cells.length,
      ...(result.kernel?.note && { kernelNote: result.kernel.note }),
      message: own
        ? view.status === "error" ? "单元格运行出错" : "单元格已运行"
        : failed ? `前面的单元格 ${failed.id} 出错，没有运行到这一格` : "单元格已运行，没有输出",
    };
  }

  function readOutput(cellId: string) {
    const { doc, outputs } = commands.read();
    const { cell } = findCell(doc, cellId);
    const output = outputs[cell.id];
    if (!output) return { cellId: cell.id, hasOutput: false, note: "这一格还没有输出。需要时先用 run_notebook_cell 运行。" };
    return { hasOutput: true, ...describeCellOutput(output) };
  }

  /**
   * `run_notebook_cell`'s prepareInvocation: the confirm for this cell, and an
   * accept-time check that the notebook and the cell's source are unchanged.
   */
  function prepareRunCell(cellId: string, reason?: string): PreparedInvocation<RanNotebookCell> {
    const opened = commands.read();
    const problems = runCellBlockers(opened, cellId);
    const sourceOf = (doc: NotebookDoc) => doc.cells.find((cell) => cell.id === cellId)?.source;
    return {
      view: runCellConfirmView(opened.doc, cellId, problems, reason),
      problems: () => {
        const latest = commands.read();
        if (latest.doc.id !== opened.doc.id) return ["当前页面已经不是这本笔记本，没有运行。"];
        if (sourceOf(latest.doc) !== sourceOf(opened.doc)) return ["确认时单元格内容已变化，没有运行。请再试一次。"];
        return runCellBlockers(latest, cellId);
      },
      invoke: () => runCell(cellId),
    };
  }

  /** Fresh read of the kernel's variables, like VS Code's Jupyter Variables view. */
  async function listVariables() {
    const result = await commands.refreshVariables();
    if (!result.available) return { available: false, reason: result.reason, variables: [] };
    const more = result.total > result.variables.length;
    return {
      ...result,
      ...(result.total === 0 && { note: "内核里还没有用户变量。" }),
      ...(more && { note: `只列出前 ${result.variables.length} 个（共 ${result.total} 个）。` }),
    };
  }

  /** One variable's type, size, dtype or columns, and a clipped repr. */
  async function getVariable(name: string) {
    const trimmed = name?.trim();
    if (!trimmed) throw new Error("需要变量名。先用 list_notebook_variables 查变量名");
    const result = await commands.readVariable(trimmed);
    if (!result.available) return { available: false, reason: result.reason };
    if (!result.found) throw new Error(`内核里没有变量 ${trimmed}。先用 list_notebook_variables 查变量名`);
    return { available: true, ...result.variable };
  }

  return { summary, editCell, prepareEditCell, runCell, readOutput, prepareRunCell, listVariables, getVariable };
}
