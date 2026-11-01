import { convertNotebook, tryRunArgv } from "./convert";
import type { CellRunResult, NotebookDoc, TryRunRecord } from "./types";

/** Demo-mode try-run. Checks the marker contract and does not execute a kernel. */
export function simulateTryRun(notebook: NotebookDoc, values: Record<string, string>): TryRunRecord {
  const converted = convertNotebook(notebook);
  let argError = "";
  try {
    tryRunArgv(converted.inputs, values);
  } catch (error) {
    argError = error instanceof Error ? error.message : "参数不完整";
  }
  const passed = notebook.language === "python" && converted.outputs.length > 0 && !argError;
  const log = passed
    ? `$ ${converted.commandPreview.replaceAll("\\\n", " ")}\n演示模式：端口契约通过。真正执行 CLI 请用 pnpm dev:real。\n完成`
    : `试跑失败${argError ? `：${argError}` : notebook.language === "r" ? "：R 脚本未在演示模式执行" : ""}`;
  return {
    notebookId: notebook.id,
    rev: notebook.rev,
    passed,
    exitCode: passed ? 0 : 1,
    durationMs: passed ? 400 : 120,
    log,
    outputs: converted.outputs.map((output) => ({
      name: output.name,
      file: output.pattern,
      bytes: passed ? 128 : 0,
      ok: passed,
      message: passed ? undefined : "未生成",
    })),
    ranAt: new Date().toISOString(),
  };
}

export function simulateCells(notebook: NotebookDoc): CellRunResult[] {
  return notebook.cells
    .filter((cell) => cell.role !== "markdown")
    .map((cell) => ({
      id: cell.id,
      stdout: cell.role === "explore" ? "（自由探索，仅留在笔记本）\n" : "（演示模式未执行内核）\n",
    }));
}

export function withSampleValues(values: Record<string, string>, sampleId: string | undefined): Record<string, string> {
  const next = { ...values };
  if (sampleId === "fastqc-pair" && !next.fastq_zip?.trim()) next.fastq_zip = "S1_fastq.zip,S2_fastq.zip";
  if (sampleId === "samplesheet" && !next.samplesheet?.trim()) next.samplesheet = "samplesheet.csv";
  return next;
}
