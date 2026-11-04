import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { CommandError, runCommand } from "@/features/project/server/command";
import { findJava, findNextflow, NEXTFLOW_PIN_ENV, toolEnvironment } from "@/features/project/server/preflight";
import { nextflowCacheEnv } from "@/lib/server/paths";
import { CELL_DRIVER } from "./cell-driver";
import { cellsForKernelRun, cellsForRun } from "./cells";
import { ConvertError, convertNotebook, tryRunArgv } from "./convert";
import { readModuleEnv, type ModuleEnvPatch } from "./env";
import { planTryRunInputs, type InputPlan, type PortBindingRequest } from "./input-bindings";
import { stageInputPlan, type StagedInputs } from "./input-bindings-stage";
import { finalizeCellResult } from "./outputs";
import { kernelFor, KernelUnavailableError, shutdownKernel } from "./server/kernels";
import {
  buildTryRunHeader,
  clipTryRunLog,
  formatArgv,
  selectTryRunEngine,
  tryRunEnvLines,
  type TryRunSelection,
  type TryRunTools,
  type TryRunVia,
} from "./try-run-env";
import { draftModuleDef, draftModuleFiles, moduleRunParams, parseModuleOutputs, TRY_RUN_NAMESPACE, tryRunNextflowConfig } from "./try-run-module";
import { condaFileProblem, discoverTryRunTools } from "./try-run-tools";
import type { CellRunResult, ConvertedNotebook, NotebookDoc, NotebookRunResult, TryRunOutput, TryRunRecord } from "./types";

// Single-cell steps such as clustering take minutes on real data; a few seconds is too short.
// Creating a conda environment or pulling an image comes on top of that.
const HOST_TIMEOUT_MS = 10 * 60_000;
const ENV_TIMEOUT_MS = 20 * 60_000;
const INPUTS_DIR = "inputs";

const inDir = (dir: string, name: string) => join(/* turbopackIgnore: true */ dir, name);

/** The Nextflow launcher and the environment it runs with. */
export interface NextflowLauncher {
  bin: string;
  env: NodeJS.ProcessEnv;
}

export interface TryRunExecOptions {
  tools?: TryRunTools;
  cacheDir?: string;
  run?: typeof runCommand;
  /** Project folder: relative input paths such as `data/sample.csv` are read from here. */
  workspace?: string;
  nextflow?: NextflowLauncher;
}

/** Nextflow with a supported Java, the same lookup project runs use. */
export async function findTryRunNextflow(): Promise<NextflowLauncher> {
  const base = toolEnvironment();
  let bin: string;
  try {
    bin = await findNextflow(base);
  } catch {
    throw new ConvertError("找不到 nextflow，无法用 Nextflow 模块测试试跑。请先在设置页安装 Nextflow。");
  }
  const { home } = await findJava(base);
  return {
    bin,
    env: {
      ...base,
      ...nextflowCacheEnv(base),
      JAVA_HOME: home,
      NXF_JAVA_HOME: home,
      NXF_ANSI_LOG: "false",
      NXF_DISABLE_CHECK_LATEST: "true",
      // Same release as pipeline runs and the sidebar badge; `module run` needs Nextflow ≥ 26.04.
      ...NEXTFLOW_PIN_ENV,
      PATH: [base.PATH, join(home, "bin")].filter(Boolean).join(delimiter),
    },
  };
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

/** Check each output port against the files Nextflow reported for it. */
async function collectOutputs(reported: Record<string, string[]>, converted: ConvertedNotebook): Promise<TryRunOutput[]> {
  const outputs: TryRunOutput[] = [];
  for (const output of converted.outputs) {
    const files = reported[output.name] ?? [];
    let bytes = 0;
    let ok = files.length > 0;
    for (const file of files) {
      try {
        const info = await stat(file);
        bytes += info.size;
        if (!info.isFile() || info.size === 0) ok = false;
      } catch {
        ok = false;
      }
    }
    outputs.push({ name: output.name, file: output.pattern, bytes, ok, ...(files.length ? {} : { message: "未生成" }) });
  }
  return outputs;
}

/** What the CLI printed, read from the task folder next to the first output. */
async function taskStreams(reported: Record<string, string[]>): Promise<string> {
  const first = Object.values(reported).flat()[0];
  if (!first) return "";
  const task = dirname(first);
  const read = (name: string) => readFile(inDir(task, name), "utf8").catch(() => "");
  return [(await read(".command.out")).trim(), (await read(".command.err")).trim()].filter(Boolean).join("\n");
}

/**
 * Publish try-run through Nextflow's module test: the converted notebook becomes the draft module a publish
 * would write (`modules/local/<slug>/main.nf` + the CLI under `resources/usr/bin`), and
 * `nextflow module run local/<slug> --<port> <value> …` runs it with the chosen conda or container.
 * It passes when Nextflow exits 0 and every output port got a non-empty file.
 */
export async function executeTryRun(
  notebook: NotebookDoc,
  bindings: PortBindingRequest[],
  envInput?: ModuleEnvPatch,
  options: TryRunExecOptions = {},
): Promise<TryRunRecord> {
  const started = Date.now();
  const converted = convertNotebook(notebook);
  const env = readModuleEnv(envInput ?? {});
  const run = options.run ?? runCommand;
  let planned: InputPlan;
  try {
    planned = planTryRunInputs(converted.inputs, bindings);
  } catch (error) {
    return refusedRecord(notebook, converted, env, started, error instanceof Error ? error.message : "无法准备输入");
  }
  const fail = (message: string) => refusedRecord(notebook, converted, env, started, message, planned);

  if (env.condaYaml) {
    const problem = await condaFileProblem(env.condaYaml);
    if (problem) return fail(problem);
  }
  let selection: TryRunSelection = { via: "host" };
  if (env.condaYaml || env.containerImage) {
    let tools: TryRunTools;
    try {
      tools = options.tools ?? await discoverTryRunTools();
    } catch (error) {
      return fail(error instanceof Error ? error.message : "无法检查运行环境");
    }
    selection = selectTryRunEngine(env, tools);
    if (selection.via === "unavailable") return fail(selection.message);
  }
  const via: TryRunVia = selection.via;
  const note = selection.via === "conda" || selection.via === "container" ? selection.note : undefined;

  let launcher: NextflowLauncher;
  try {
    launcher = options.nextflow ?? await findTryRunNextflow();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "找不到 nextflow");
  }

  const dir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "nb-try-"));
  try {
    const inputsDir = inDir(dir, INPUTS_DIR);
    await mkdir(inputsDir);
    let staged: StagedInputs;
    let params: string[];
    try {
      staged = await stageInputPlan(inputsDir, planned, [], { workspace: options.workspace });
      tryRunArgv(converted.inputs, staged.values);
      params = moduleRunParams(converted.inputs, staged.values, INPUTS_DIR);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "无法准备输入");
    }

    const def = draftModuleDef(notebook, converted, env);
    for (const file of draftModuleFiles(def)) {
      const path = inDir(dir, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, file.executable ? { mode: 0o755 } : undefined);
    }
    await writeFile(inDir(dir, "nextflow.config"), tryRunNextflowConfig(selection));

    const target = `${TRY_RUN_NAMESPACE}/${def.path}`;
    const args = ["-q", "module", "run", target, ...params, "-output-format", "json"];
    const runEnv: NodeJS.ProcessEnv = { ...launcher.env };
    if (options.cacheDir) runEnv.NXF_CONDA_CACHEDIR = options.cacheDir;
    // A runtime found outside PATH (TRY_RUN_*_BIN) still has to be visible to Nextflow by name.
    const toolBin = selection.via === "conda" || selection.via === "container" ? selection.tool.bin : undefined;
    if (toolBin) runEnv.PATH = [dirname(toolBin), runEnv.PATH].filter(Boolean).join(delimiter);

    let exitCode: number | null = 0;
    let output = "";
    try {
      output = await run(launcher.bin, args, {
        cwd: dir,
        env: runEnv,
        timeoutMs: via === "host" ? HOST_TIMEOUT_MS : ENV_TIMEOUT_MS,
        quiet: true,
      });
    } catch (error) {
      if (error instanceof CommandError) {
        exitCode = error.exitCode;
        output = (error.output || error.message).trim();
      } else {
        exitCode = null;
        output = error instanceof Error ? error.message : "试跑失败";
      }
    }
    const reported = exitCode === 0 ? parseModuleOutputs(output) : {};
    const outputs = await collectOutputs(reported, converted);
    const passed = exitCode === 0 && outputs.length > 0 && outputs.every((item) => item.ok);
    const durationMs = Date.now() - started;
    const header = buildTryRunHeader(
      [...tryRunEnvLines({ env, via, language: converted.language, note }), ...staged.lines, `Nextflow 模块测试：modules/${target}`],
      [formatArgv(["nextflow", "module", "run", target, ...params])],
    );
    const body = exitCode === 0 ? await taskStreams(reported) : output;
    const tail = [body, passed ? `完成，用时 ${durationMs}ms` : exitCode === 0 ? "输出端口没有生成文件" : ""].filter(Boolean).join("\n");
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

const R_EDIT_ONLY = "没有 R 内核，R 单元格不在这里运行（发布后的试跑用 Rscript）。";
const R_KERNEL_HINT = "安装 R 内核：install.packages(\"IRkernel\"); IRkernel::installspec()。";
const ONESHOT_HINT = "单元格每次从头运行；安装 ipykernel 后保留变量：python3 -m pip install ipykernel";

/**
 * Runs notebook cells the Jupyter way. A cell id runs just that cell in the notebook's persistent kernel,
 * so variables and files from earlier runs stay. No cell id restarts the kernel and runs every cell,
 * stopping at the first error. Without Jupyter it falls back to a fresh process from the top.
 */
export async function runNotebookCells(notebook: NotebookDoc, cellId?: string, workspace?: string): Promise<NotebookRunResult> {
  const cells = cellsForKernelRun(notebook, cellId);
  if (cells.length === 0) return { cells: [] };
  const r = notebook.language !== "python";
  const oneshot = async (note: string): Promise<NotebookRunResult> => r ? { cells: cells.map((cell) => finalizeCellResult(cell.id, { error: `${note}${R_EDIT_ONLY}` })) } : ({
    cells: await executeCells(notebook, cellId, workspace),
    kernel: { mode: "oneshot", note },
  });
  if (process.env.NEXTFLOW_STUDIO_KERNEL === "oneshot") return oneshot(r ? "" : ONESHOT_HINT);

  if (!cellId) shutdownKernel(notebook.id);
  let session: Awaited<ReturnType<typeof kernelFor>>;
  try {
    session = await kernelFor(notebook.id, notebook.kernel, r ? "r" : "python", workspace);
    await session.whenReady();
  } catch (error) {
    if (error instanceof KernelUnavailableError) return oneshot(r ? `${error.message}。${R_KERNEL_HINT}` : `${error.message}。${ONESHOT_HINT}`);
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
/** `workspace` is the working directory of the cells (the project folder); the driver's own files stay in a temporary one. */
export async function executeCells(notebook: NotebookDoc, cellId?: string, workspace?: string): Promise<CellRunResult[]> {
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
      await runCommand("python3", [inDir(dir, "driver.py")], { cwd: workspace ?? dir, timeoutMs: HOST_TIMEOUT_MS, quiet: true });
    } catch (error) {
      failure = failureText(error);
    }
    return readCellResults(dir, cells, failure || "单元格没有返回结果");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
