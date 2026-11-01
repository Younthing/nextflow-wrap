import { ConvertError } from "./convert";
import type { NotebookCell, NotebookDoc } from "./types";

function runnable(cells: NotebookCell[]): NotebookCell[] {
  return cells.filter((cell) => cell.role !== "markdown");
}

/** Runnable cells. A cell id includes earlier cells because each run starts a fresh process. */
export function cellsForRun(notebook: NotebookDoc, cellId?: string): NotebookCell[] {
  if (!cellId) return runnable(notebook.cells);
  const index = notebook.cells.findIndex((cell) => cell.id === cellId);
  if (index < 0) throw new ConvertError("单元格不存在");
  if (notebook.cells[index].role === "markdown") return [];
  return runnable(notebook.cells.slice(0, index + 1));
}

export function nextCellId(cells: readonly { id: string }[], id: string): string | null {
  const index = cells.findIndex((cell) => cell.id === id);
  if (index < 0 || index >= cells.length - 1) return null;
  return cells[index + 1].id;
}
