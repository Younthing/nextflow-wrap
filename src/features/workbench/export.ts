import { writePercent } from "@/features/notebook/jupytext";
import type { CellOutput, CellRunResult, NotebookDoc } from "@/features/notebook/types";

/** A file the browser can save. */
export interface ExportFile {
  name: string;
  type: string;
  content: string;
}

/** File name stem from the notebook name: keeps letters (CJK too), digits, `-` and `_`. */
export function exportStem(name: string): string {
  const stem = name.trim().replace(/[\s/\\:*?"<>|]+/g, "_").replace(/^_+|_+$/g, "");
  return stem || "notebook";
}

const lines = (text: string) => (text ? text.split(/(?<=\n)/) : []);

function nbOutput(output: CellOutput, count?: number) {
  if (output.outputType === "stream") return { output_type: "stream", name: output.name, text: lines(output.text) };
  if (output.outputType === "error") return { output_type: "error", ename: "Error", evalue: output.traceback.split("\n").at(-1) ?? "", traceback: output.traceback.split("\n") };
  const data = Object.fromEntries(Object.entries(output.data).map(([mime, value]) => [mime, typeof value === "string" && mime.startsWith("text/") ? lines(value) : value]));
  return output.outputType === "execute_result"
    ? { output_type: "execute_result", execution_count: count ?? null, data, metadata: {} }
    : { output_type: "display_data", data, metadata: {} };
}

/**
 * nbformat 4.5 JSON that Jupyter opens. Cell roles (input, output, explore) travel in `metadata.nextflow_studio`
 * so a round trip keeps them; outputs from this session are included when given.
 */
export function toIpynb(doc: Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells">, results: Record<string, CellRunResult> = {}): ExportFile {
  const python = doc.language === "python";
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: python
        ? { name: "python3", display_name: "Python 3", language: "python" }
        : { name: "ir", display_name: "R", language: "R" },
      language_info: { name: python ? "python" : "R" },
      nextflow_studio: { name: doc.name, description: doc.description, kernel: doc.kernel },
    },
    cells: doc.cells.map((cell) => {
      const base = { id: cell.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || "cell", source: lines(cell.source) };
      if (cell.role === "markdown") return { ...base, cell_type: "markdown", metadata: {} };
      const result = results[cell.id];
      return {
        ...base,
        cell_type: "code",
        execution_count: result?.executionCount ?? null,
        metadata: cell.role === "code" ? {} : { nextflow_studio: { role: cell.role } },
        outputs: (result?.outputs ?? []).map((output) => nbOutput(output, result?.executionCount)),
      };
    }),
  };
  return { name: `${exportStem(doc.name)}.ipynb`, type: "application/x-ipynb+json", content: `${JSON.stringify(notebook, null, 1)}\n` };
}

/** Jupytext percent script (`.py` or `.R`), the same format a published module keeps. */
export function toScript(doc: Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells">): ExportFile {
  const r = doc.language === "r";
  return { name: `${exportStem(doc.name)}${r ? ".R" : ".py"}`, type: "text/plain", content: writePercent(doc) };
}

/** Markdown summary of the port markers, shown next to "导出为模块…". */
export function portSummary(inputs: number, outputs: number): string {
  if (!inputs && !outputs) return "先把单元格标成输入、输出";
  return `已标 ${inputs} 个输入、${outputs} 个输出`;
}
