import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CommandError, runCommand } from "@/features/project/server/command";
import { CELL_DRIVER } from "./cell-driver";
import { cellsForKernelRun, cellsForRun } from "./cells";
import { ConvertError, convertNotebook, scriptFileName, scriptInterpreter, tryRunArgv } from "./convert";
import { readModuleEnv, type ModuleEnvPatch } from "./env";
import { planTryRunInputs, type InputPlan, type PortBindingRequest } from "./input-bindings";
import { stageInputPlan, type StagedInputs } from "./input-bindings-stage";
import { finalizeCellResult } from "./outputs";
import { kernelFor, KernelUnavailableError, shutdownKernel } from "./server/kernels";
import {
  buildTryRunHeader,
  clipTryRunLog,
  condaCreateCommand,
  condaRunCommand,
  containerCommand,
  formatArgv,
  hostTryRunCommand,
  selectTryRunEngine,
  tryRunEnvLines,
  type TryRunTools,
  type TryRunVia,
} from "./try-run-env";
import { condaCachePrefix, condaFileProblem, discoverTryRunTools } from "./try-run-tools";
import type { CellRunResult, ConvertedNotebook, NotebookDoc, NotebookRunResult, TryRunOutput, TryRunRecord } from "./types";

// Single-cell steps such as clustering take minutes on real data; a few seconds is too short.
const HOST_TIMEOUT_MS = 10 * 60_000;
const ENV_TIMEOUT_MS = 10 * 60_000;

const inDir = (dir: string, name: string) => join(/* turbopackIgnore: true */ dir, name);

export interface TryRunExecOptions {
  tools?: TryRunTools;
  cacheDir?: string;
  run?: typeof runCommand;
}

interface LaunchStep {
  executable: string;
  args: string[];
  timeoutMs: number;
  display?: string;
  cleanup?: () => Promise<void>;
}

function safeOutputName(pattern: string): string {
  if (!/^[\w.-]+$/.test(pattern)) throw new ConvertError(`输出文件名无效：${pattern}`);
  return pattern;
}

function envFields(env: { condaYaml?: string; containerImage?: string }, via?: TryRunVia) {
  return {
    ...(env.condaYaml ? { condaYaml: env.condaYaml } : {}),
    ...(env.containerImage ? { containerImage: env.containerImage } : {}),
    ...(via ? { envVia: via } : {}),
  };
}

function missedOutputs(converted: ConvertedNotebook): TryRunOutput[] {
  return converted.outputs.map((output) => ({
    name: output.name,
    file: output.pattern,
    bytes: 0,
    ok: false,
    message: "未生成",
  }));
}

function refusedRecord(
  notebook: NotebookDoc,
  converted: ConvertedNotebook,
  env: { condaYaml?: string; containerImage?: string },
  started: number,
  message: string,
  planned?: Pick<InputPlan, "lines" | "records">,
): TryRunRecord {
  // Keep the conda/container lines and omit the host choice. The run was refused.
  const directives = tryRunEnvLines({ env, via: "host", language: converted.language }).slice(0, 1);
  return {
    notebookId: notebook.id,
    rev: notebook.rev,
    passed: false,
    exitCode: null,
    durationMs: Date.now() - started,
    log: [...directives, ...(planned?.lines ?? []), message].filter(Boolean).join("\n"),
    outputs: missedOutputs(converted),
    ranAt: new Date().toISOString(),
    ...(planned?.records?.length ? { bindings: planned.records } : {}),
    ...envFields(env),
  };
}

async function collectOutputs(dir: string, converted: ConvertedNotebook): Promise<TryRunOutput[]> {
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
  return outputs;
}

export async function executeTryRun(
  notebook: NotebookDoc,
  bindings: PortBindingRequest[],
  envInput?: ModuleEnvPatch,
  options: TryRunExecOptions = {},
): Promise<TryRunRecord> {
  const started = Date.now();
  const converted = convertNotebook(notebook);
  const env = readModuleEnv(envInput ?? {});
  const scriptName = scriptFileName(converted.entry);
  const interpreter = scriptInterpreter(converted.language);
  const run = options.run ?? runCommand;
  let planned: InputPlan;
  try {
    planned = planTryRunInputs(converted.inputs, bindings);
  } catch (error) {
    return refusedRecord(notebook, converted, env, started, error instanceof Error ? error.message : "无法准备输入");
  }
  const fail = (message: string) => refusedRecord(notebook, converted, env, started, message, planned);

  const perform = async (
    dir: string,
    steps: LaunchStep[],
    via: TryRunVia,
    staged: StagedInputs,
    note?: string,
  ): Promise<TryRunRecord> => {
    let exitCode: number | null = 0;
    let output = "";
    const displays: string[] = [];
    for (const step of steps) {
      if (exitCode !== 0) break;
      displays.push(step.display ?? formatArgv([step.executable, ...step.args]));
      try {
        const chunk = await run(step.executable, step.args, { cwd: dir, timeoutMs: step.timeoutMs, quiet: true });
        output = [output, chunk.trim()].filter(Boolean).join("\n");
      } catch (error) {
        if (step.cleanup) await step.cleanup();
        if (error instanceof CommandError) {
          exitCode = error.exitCode;
          output = [output, (error.output || error.message).trim()].filter(Boolean).join("\n");
        } else {
          exitCode = null;
          output = [output, error instanceof Error ? error.message : "试跑失败"].filter(Boolean).join("\n");
        }
      }
    }
    const outputs = await collectOutputs(dir, converted);
    const passed = exitCode === 0 && outputs.length > 0 && outputs.every((item) => item.ok);
    const durationMs = Date.now() - started;
    const header = buildTryRunHeader(
      [...tryRunEnvLines({ env, via, language: converted.language, note }), ...staged.lines],
      displays,
    );
    const tail = [output, passed ? `完成，用时 ${durationMs}ms` : ""].filter(Boolean).join("\n");
    return {
      notebookId: notebook.id,
      rev: notebook.rev,
      passed,
      exitCode,
      durationMs,
      log: clipTryRunLog(header, tail),
      outputs,
      ranAt: new Date().toISOString(),
      bindings: staged.records,
      ...envFields(env, via),
    };
  };

  const inWorkDir = async (
    stepsFor: (dir: string, argv: string[]) => Promise<LaunchStep[]> | LaunchStep[],
    via: TryRunVia,
    note?: string,
  ) => {
    const dir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "nb-try-"));
    try {
      let staged: StagedInputs;
      try {
        staged = await stageInputPlan(dir, planned, [scriptName]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "无法准备输入");
      }
      await writeFile(inDir(dir, scriptName), converted.script, { mode: 0o755 });
      let argv: string[];
      try {
        argv = tryRunArgv(converted.inputs, staged.values);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "无法准备输入");
      }
      return await perform(dir, await stepsFor(dir, argv), via, staged, note);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const hostSteps = (_dir: string, argv: string[]): LaunchStep[] => [{
    executable: interpreter,
    args: [scriptName, ...argv],
    timeoutMs: HOST_TIMEOUT_MS,
    display: hostTryRunCommand(converted.language, converted.entry, argv),
  }];

  if (!env.condaYaml && !env.containerImage) return inWorkDir(hostSteps, "host");

  if (env.condaYaml) {
    const problem = await condaFileProblem(env.condaYaml);
    if (problem) return fail(problem);
  }

  let tools: TryRunTools;
  try {
    tools = options.tools ?? await discoverTryRunTools();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "无法检查运行环境");
  }
  const selection = selectTryRunEngine(env, tools);
  if (selection.via === "unavailable") return fail(selection.message);
  if (selection.via === "host") return inWorkDir(hostSteps, "host");
  if (selection.via === "container") {
    const image = env.containerImage ?? "";
    return inWorkDir((dir, argv) => {
      const launch = containerCommand(selection.tool, dir, image, [interpreter, scriptName, ...argv]);
      return [{ executable: launch.executable, args: launch.args, timeoutMs: ENV_TIMEOUT_MS }];
    }, "container", selection.note);
  }

  const yamlPath = env.condaYaml ?? "";
  const prefix = await condaCachePrefix(yamlPath, options.cacheDir);
  await mkdir(dirname(prefix), { recursive: true });
  let ready = false;
  try {
    await access(prefix);
    ready = true;
  } catch {
    ready = false;
  }
  return inWorkDir((_dir, argv) => {
    const steps: LaunchStep[] = [];
    if (!ready) {
      const create = condaCreateCommand(selection.tool, prefix, yamlPath);
      steps.push({
        executable: create.executable,
        args: create.args,
        timeoutMs: ENV_TIMEOUT_MS,
        cleanup: () => rm(prefix, { recursive: true, force: true }),
      });
    }
    const launch = condaRunCommand(selection.tool, prefix, [interpreter, scriptName, ...argv]);
    steps.push({ executable: launch.executable, args: launch.args, timeoutMs: ENV_TIMEOUT_MS });
    return steps;
  }, "conda", selection.note);
}

function failureText(error: unknown): string {
  const message = error instanceof CommandError ? error.output || error.message : error instanceof Error ? error.message : "运行失败";
  return message.trim().slice(-2000) || "运行失败";
}

async function readCellResults(dir: string, cells: { id: string }[], fallback: string): Promise<CellRunResult[]> {
  try {
    const raw = await readFile(inDir(dir, "results.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("bad results");
    const byId = new Map<string, CellRunResult>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as { id?: unknown; outputs?: unknown; error?: unknown };
      if (typeof record.id !== "string" || !record.id) continue;
      byId.set(record.id, finalizeCellResult(record.id, record));
    }
    return cells.map((cell) => byId.get(cell.id) ?? finalizeCellResult(cell.id, { error: "单元格没有返回结果" }));
  } catch {
    return cells.map((cell) => finalizeCellResult(cell.id, { error: fallback }));
  }
}

const R_EDIT_ONLY = "R 单元格在笔记本里只作编辑；发布后的试跑会调用 Rscript。";
const ONESHOT_HINT = "单元格每次从头在新进程里运行。安装 ipykernel 后改用常驻 Jupyter 内核：python3 -m pip install ipykernel";

/**
 * Runs notebook cells the Jupyter way. A cell id runs just that cell in the notebook's persistent kernel,
 * so variables and files from earlier runs stay. No cell id restarts the kernel and runs every cell,
 * stopping at the first error. Without Jupyter it falls back to a fresh process from the top.
 */
export async function runNotebookCells(notebook: NotebookDoc, cellId?: string): Promise<NotebookRunResult> {
  const cells = cellsForKernelRun(notebook, cellId);
  if (cells.length === 0) return { cells: [] };
  if (notebook.language !== "python") {
    return { cells: cells.map((cell) => finalizeCellResult(cell.id, { error: R_EDIT_ONLY })) };
  }
  const oneshot = async (note: string): Promise<NotebookRunResult> => ({
    cells: await executeCells(notebook, cellId),
    kernel: { mode: "oneshot", note },
  });
  if (process.env.NEXTFLOW_STUDIO_KERNEL === "oneshot") return oneshot(ONESHOT_HINT);

  if (!cellId) shutdownKernel(notebook.id);
  let session: Awaited<ReturnType<typeof kernelFor>>;
  try {
    session = await kernelFor(notebook.id, notebook.kernel);
    await session.whenReady();
  } catch (error) {
    if (error instanceof KernelUnavailableError) return oneshot(`${error.message}。${ONESHOT_HINT}`);
    const message = `内核启动失败：${failureText(error)}`;
    return { cells: cells.map((cell) => finalizeCellResult(cell.id, { error: message })) };
  }

  const results: CellRunResult[] = [];
  for (const cell of cells) {
    try {
      const reply = await session.execute(cell.source);
      const result = finalizeCellResult(cell.id, { outputs: reply.outputs });
      results.push(reply.executionCount === null ? result : { ...result, executionCount: reply.executionCount });
      if (reply.status !== "ok") break;
    } catch (error) {
      results.push(finalizeCellResult(cell.id, { error: failureText(error) }));
      break;
    }
  }
  return { cells: results, kernel: { mode: "jupyter", kernel: session.kernel, ...(session.note ? { note: session.note } : {}) } };
}

/** Runs notebook cells in one Python process. A cell id runs from the top through that cell. Markdown is skipped. */
export async function executeCells(notebook: NotebookDoc, cellId?: string): Promise<CellRunResult[]> {
  const cells = cellsForRun(notebook, cellId);
  if (cells.length === 0) return [];
  if (notebook.language !== "python") {
    return cells.map((cell) => finalizeCellResult(cell.id, { error: R_EDIT_ONLY }));
  }
  const dir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "nb-run-"));
  try {
    await writeFile(inDir(dir, "cells.json"), JSON.stringify(cells.map((cell) => ({ id: cell.id, source: cell.source }))));
    await writeFile(inDir(dir, "driver.py"), CELL_DRIVER);
    let failure = "";
    try {
      await runCommand("python3", ["driver.py"], { cwd: dir, timeoutMs: HOST_TIMEOUT_MS, quiet: true });
    } catch (error) {
      failure = failureText(error);
    }
    return readCellResults(dir, cells, failure || "单元格没有返回结果");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
