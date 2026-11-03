import { cellsForRun } from "./cells";
import { convertNotebook, tryRunArgv } from "./convert";
import { readModuleEnv, type ModuleEnvPatch } from "./env";
import { planTryRunInputs, type InputPlan, type PortBindingRequest } from "./input-bindings";
import { finalizeCellResult } from "./outputs";
import { buildTryRunHeader, demoTryRunLines, formatArgv } from "./try-run-env";
import { draftModuleDef, moduleRunParams, TRY_RUN_NAMESPACE } from "./try-run-module";
import type { CellRunResult, NotebookDoc, TryRunRecord } from "./types";

/** Demo-mode try-run. Checks the marker contract and does not execute a kernel. */
export function simulateTryRun(
  notebook: NotebookDoc,
  bindings: PortBindingRequest[],
  envInput?: ModuleEnvPatch,
): TryRunRecord {
  const converted = convertNotebook(notebook);
  const env = readModuleEnv(envInput ?? {});
  let params: string[] = [];
  let argError = "";
  let planned: InputPlan | undefined;
  try {
    planned = planTryRunInputs(converted.inputs, bindings);
    tryRunArgv(converted.inputs, planned.values);
    params = moduleRunParams(converted.inputs, planned.values, "inputs");
  } catch (error) {
    argError = error instanceof Error ? error.message : "参数不完整";
  }
  const passed = notebook.language === "python" && converted.outputs.length > 0 && !argError;
  const header = buildTryRunHeader(
    [...demoTryRunLines(env, notebook.language), ...(planned?.lines ?? [])],
    [formatArgv(["nextflow", "module", "run", `${TRY_RUN_NAMESPACE}/${draftModuleDef(notebook, converted, env).path}`, ...params])],
  );
  const log = passed
    ? `${header}\n演示模式：端口契约通过。真正用 Nextflow 运行模块请用 pnpm dev:real。\n完成`
    : `${header}\n试跑失败${argError ? `：${argError}` : notebook.language === "r" ? "：R 脚本未在演示模式执行" : ""}`;
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
    ...(planned?.records.length ? { bindings: planned.records } : {}),
    ...(env.condaYaml ? { condaYaml: env.condaYaml } : {}),
    ...(env.containerImage ? { containerImage: env.containerImage } : {}),
    ...(!env.condaYaml && !env.containerImage ? { envVia: "host" as const } : {}),
  };
}

export function simulateCells(notebook: NotebookDoc, cellId?: string): CellRunResult[] {
  return cellsForRun(notebook, cellId).map((cell) => {
    const stdout = cell.role === "explore" ? "（自由探索，仅留在笔记本）\n" : "（演示模式未执行内核）\n";
    return finalizeCellResult(cell.id, {
      outputs: [{ outputType: "stream", name: "stdout", text: stdout }],
    });
  });
}
