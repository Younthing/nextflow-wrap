import { patternParams, usesSamplesheet } from "@/features/project/schema";
import { inputParams } from "@/features/workflow/inputs";
import type { PipelineParams, WorkflowDoc } from "@/features/workflow/types";
import { dataPathKind, normalizeWorkspacePath, resolveWorkspacePath } from "@/features/workspace/paths";

/** Params that name input data: file and folder nodes, the samplesheet's `--input`, file params of channel operators. */
export function dataPathParams(doc: Pick<WorkflowDoc, "nodes">): string[] {
  return [
    ...inputParams(doc).map((input) => input.name),
    ...(usesSamplesheet(doc) ? ["input"] : []),
    ...patternParams(doc).filter((param) => param.kind === "file").map((param) => param.name),
  ];
}

const isGlob = (value: string) => /[*?[{]/.test(value);

/**
 * Turns the data params of a run into paths Nextflow can open. Workspace paths (`data/reads.fq`) resolve inside the
 * project folder and must exist; URIs pass through. A local run takes nothing from outside the workspace. A cluster
 * run takes absolute cluster paths as they are, and lists the workspace paths it uses in `sync`: the runner copies
 * them into the project's folder on the cluster and points the params there.
 */
export function resolveDataParams(
  params: PipelineParams,
  names: readonly string[],
  options: { root?: string; remote: boolean; exists: (path: string) => boolean },
): { params: PipelineParams; errors: string[]; sync: string[] } {
  const out: PipelineParams = { ...params };
  const errors: string[] = [];
  const sync: string[] = [];
  for (const name of new Set(names)) {
    const value = params[name];
    if (typeof value !== "string" || !value.trim()) continue;
    const kind = dataPathKind(value);
    if (kind === "uri") continue;
    if (kind === "invalid") { errors.push(`--${name} 不是有效的路径：${value}`); continue; }
    if (options.remote) {
      if (kind !== "workspace") continue;
      const relative = normalizeWorkspacePath(value)!;
      if (relative === "." || relative.startsWith("..")) errors.push(`--${name} 不在项目文件夹里，集群运行无法上传：${value}`);
      else if (isGlob(value)) errors.push(`--${name} 是工作区里的通配路径，集群运行请改成文件夹，或填写集群上的绝对路径`);
      else if (!options.root) { errors.push("流程不属于任何项目，无法解析工作区路径"); break; }
      else if (!options.exists(resolveWorkspacePath(value, options.root)!)) errors.push(`工作区里没有 ${value}`);
      else { sync.push(relative); out[name] = relative; }
      continue;
    }
    if (kind === "absolute") {
      if (!isGlob(value) && !options.exists(value)) errors.push(`找不到外部数据：${value}`);
      continue;
    }
    if (!options.root) { errors.push("流程不属于任何项目，无法解析工作区路径"); break; }
    const resolved = resolveWorkspacePath(value, options.root)!;
    if (!isGlob(value) && !options.exists(resolved)) { errors.push(`工作区里没有 ${value}`); continue; }
    out[name] = resolved;
  }
  return { params: out, errors, sync };
}

/**
 * Cells of a samplesheet that name workspace files (`data/S1_R1.fq.gz`): what a cluster run must copy along with the
 * sheet. Cells that are not paths, or name nothing in the workspace, are left to the samplesheet check at run time.
 */
export function samplesheetWorkspaceFiles(csv: string, exists: (relative: string) => boolean): string[] {
  const found = new Set<string>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    for (const raw of line.split(/[,\t]/)) {
      const cell = raw.trim().replace(/^"(.*)"$/, "$1");
      if (!cell.includes("/") || dataPathKind(cell) !== "workspace") continue;
      const relative = normalizeWorkspacePath(cell)!;
      if (!relative.startsWith("..") && exists(relative)) found.add(relative);
    }
  }
  return [...found];
}
