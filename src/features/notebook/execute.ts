import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandError, runCommand } from "@/features/project/server/command";
import { cellsForRun } from "./cells";
import { ConvertError, convertNotebook, scriptFileName, scriptInterpreter, tryRunArgv, tryRunCommand } from "./convert";
import type { CellRunResult, NotebookDoc, TryRunOutput, TryRunRecord } from "./types";

const inDir = (dir: string, name: string) => join(/* turbopackIgnore: true */ dir, name);

function safeOutputName(pattern: string): string {
  if (!/^[\w.-]+$/.test(pattern)) throw new ConvertError(`输出文件名无效：${pattern}`);
  return pattern;
}

export async function materializeSample(dir: string, sampleId: string | undefined): Promise<void> {
  if (sampleId === "fastqc-pair") {
    await writeFile(inDir(dir, "S1_fastq.zip"), "sample-s1");
    await writeFile(inDir(dir, "S2_fastq.zip"), "sample-s2");
  }
  if (sampleId === "samplesheet") {
    await writeFile(inDir(dir, "samplesheet.csv"), "sample,fastq_1\nS1,a.fq\n");
  }
}

export async function executeTryRun(
  notebook: NotebookDoc,
  values: Record<string, string>,
  sampleId?: string,
): Promise<TryRunRecord> {
  const started = Date.now();
  const converted = convertNotebook(notebook);
  const dir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "nb-try-"));
  try {
    await materializeSample(dir, sampleId);
    const scriptName = scriptFileName(converted.entry);
    await writeFile(inDir(dir, scriptName), converted.script, { mode: 0o755 });
    const argv = tryRunArgv(converted.inputs, values);
    const bin = scriptInterpreter(converted.language);
    let exitCode: number | null = 0;
    let log = "";
    try {
      log = await runCommand(bin, [scriptName, ...argv], { cwd: dir, timeoutMs: 20_000, quiet: true });
    } catch (error) {
      if (error instanceof CommandError) {
        exitCode = error.exitCode;
        log = error.output || error.message;
      } else {
        exitCode = null;
        log = error instanceof Error ? error.message : "试跑失败";
      }
    }
    const outputs: TryRunOutput[] = [];
    for (const output of converted.outputs) {
      const outputFile = safeOutputName(output.pattern);
      try {
        const info = await stat(inDir(dir, outputFile));
        outputs.push({
          name: output.name,
          file: output.pattern,
          bytes: info.size,
          ok: info.isFile() && info.size > 0,
        });
      } catch {
        outputs.push({ name: output.name, file: output.pattern, bytes: 0, ok: false, message: "未生成" });
      }
    }
    const passed = exitCode === 0 && outputs.length > 0 && outputs.every((item) => item.ok);
    const durationMs = Date.now() - started;
    const header = `$ ${tryRunCommand(converted.language, converted.entry, argv)}`;
    const body = [header, log.trim(), passed ? `完成，用时 ${durationMs}ms` : ""].filter(Boolean).join("\n");
    return {
      notebookId: notebook.id,
      rev: notebook.rev,
      passed,
      exitCode,
      durationMs,
      log: body.slice(-12_000),
      outputs,
      ranAt: new Date().toISOString(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CELL_DRIVER = `
import contextlib, io, json, traceback
cells = json.load(open("cells.json", encoding="utf-8"))
ns = {"__name__": "__main__"}
for cell in cells:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            exec(compile(cell["source"], cell["id"], "exec"), ns, ns)
        print(json.dumps({"id": cell["id"], "stdout": buf.getvalue()}, ensure_ascii=False))
    except Exception:
        print(json.dumps({"id": cell["id"], "stdout": buf.getvalue(), "error": traceback.format_exc()}, ensure_ascii=False))
`;

/** Runs notebook cells in one Python process. A cell id runs from the top through that cell. Markdown is skipped. */
export async function executeCells(notebook: NotebookDoc, cellId?: string): Promise<CellRunResult[]> {
  const cells = cellsForRun(notebook, cellId);
  if (cells.length === 0) return [];
  if (notebook.language !== "python") {
    return cells.map((cell) => ({
      id: cell.id,
      stdout: "",
      error: "R 单元格在笔记本里只作编辑；发布后的试跑会调用 Rscript。",
    }));
  }
  const dir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "nb-run-"));
  try {
    await writeFile(inDir(dir, "cells.json"), JSON.stringify(cells.map((cell) => ({ id: cell.id, source: cell.source }))));
    await writeFile(inDir(dir, "driver.py"), CELL_DRIVER);
    let log = "";
    try {
      log = await runCommand("python3", ["driver.py"], { cwd: dir, timeoutMs: 20_000, quiet: true });
    } catch (error) {
      const message = error instanceof CommandError ? error.output || error.message : error instanceof Error ? error.message : "运行失败";
      return cells.map((cell) => ({ id: cell.id, stdout: "", error: message.trim().slice(-2000) }));
    }
    const byId = new Map<string, CellRunResult>();
    for (const line of log.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(line) as CellRunResult;
        if (parsed.id) byId.set(parsed.id, { id: parsed.id, stdout: parsed.stdout ?? "", error: parsed.error });
      } catch {
        // User code cannot reach this stream; ignore a torn line.
      }
    }
    return cells.map((cell) => byId.get(cell.id) ?? { id: cell.id, stdout: "", error: "单元格没有返回结果" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
