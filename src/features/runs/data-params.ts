import { patternParams, usesSamplesheet } from "@/features/project/schema";
import { inputParams } from "@/features/workflow/inputs";
import type { PipelineParams, WorkflowDoc } from "@/features/workflow/types";
import { dataPathKind, resolveWorkspacePath } from "@/features/workspace/paths";

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
 * project folder and must exist; URIs pass through. A local run takes nothing from outside the workspace; a cluster
 * run reads its data on the cluster, so it takes absolute cluster paths and no workspace paths (those files are here).
 */
export function resolveDataParams(
  params: PipelineParams,
  names: readonly string[],
  options: { root?: string; remote: boolean; exists: (path: string) => boolean },
): { params: PipelineParams; errors: string[] } {
  const out: PipelineParams = { ...params };
  const errors: string[] = [];
  for (const name of new Set(names)) {
    const value = params[name];
    if (typeof value !== "string" || !value.trim()) continue;
    const kind = dataPathKind(value);
    if (kind === "uri") continue;
    if (kind === "invalid") { errors.push(`--${name} 不是有效的路径：${value}`); continue; }
    if (options.remote) {
      if (kind === "workspace") errors.push(`--${name} 是工作区里的文件，集群上没有；集群运行请填集群上的绝对路径`);
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
  return { params: out, errors };
}
