import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { generateProject } from "@/features/project/generate";
import type { ScriptLayout } from "@/features/project/script-process";
import {
  defaultLaunchConfig,
  ENGINES,
  EXECUTORS,
  executorDef,
  EXTRA_PROFILES,
  launchCommand,
  launchProblems,
  profileList,
  renderRunConfig,
  type ContainerEngine,
  type ExecutorId,
  type LaunchConfig,
} from "@/features/project/launch";
import { indexModules } from "@/features/workflow/catalog";
import { parseWorkflowDoc } from "@/features/workflow/document";
import type { WorkflowDoc } from "@/features/workflow/types";
import { validateWorkflow } from "@/features/workflow/validate";
import { store, type StoredExecution } from "@/lib/server/database";
import { executionDirectory, pipelineDirectory } from "@/lib/server/paths";
import type { RunProgress } from "../types";

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function assertSameOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const expected = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected)) throw new HttpError(403, "不允许跨站执行操作");
}
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const paramsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), scalar);
const workflowSchema = z.object({
  version: z.literal(1), id: z.string().max(100), name: z.string().min(1).max(200), description: z.string().max(5000).optional(), updatedAt: z.string(),
  project: z.object({ name: z.string().regex(/^[a-zA-Z0-9_/.-]+$/), version: z.string().regex(/^[\w.-]+$/), author: z.string().max(200) }).optional(),
  params: paramsSchema,
  nodes: z.array(z.object({ id: z.string().min(1).max(100), position: z.object({ x: z.number(), y: z.number() }), data: z.object({ moduleId: z.string(), alias: z.string().regex(/^[A-Z][A-Z0-9_]*$/), widgets: z.record(z.string(), scalar), config: z.object({ args: z.string().optional(), prefix: z.string().optional(), label: z.string().optional(), publish: z.boolean().optional(), errorStrategy: z.string().max(40).optional(), when: z.string().max(500).optional(), whenEmpty: z.boolean().optional(), skip: z.boolean().optional(), memory: z.string().max(500).optional(), cpus: z.string().max(200).optional(), optionalOutputs: z.string().max(500).optional(), publishPath: z.string().max(500).optional(), publishPattern: z.string().max(200).optional(), publishSaveAs: z.string().max(500).optional(), publishDirs: z.array(z.object({ path: z.string().max(500), pattern: z.string().max(200).optional(), saveAs: z.string().max(500).optional() })).max(20).optional() }), settings: z.record(z.string(), scalar).optional(), disabled: z.boolean().optional() }) })).max(500),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), sourceHandle: z.string(), targetHandle: z.string() })).max(2000),
});
const plainText = (max: number) => z.string().max(max).regex(/^[^\u0000-\u001f]*$/, "不能包含换行或控制字符");
const launchSchema = z.object({
  executor: z.enum(EXECUTORS.map((executor) => executor.id) as [ExecutorId, ...ExecutorId[]]),
  engine: z.enum(ENGINES as [ContainerEngine, ...ContainerEngine[]]),
  settings: z.record(z.string(), z.union([plainText(500), z.number().finite(), z.boolean()])),
  extraProfiles: z.array(z.enum(EXTRA_PROFILES)).max(EXTRA_PROFILES.length),
  workDir: plainText(1000), resume: z.boolean(), registry: z.enum(["quay.io", "docker.rainbond.cc"]), runName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,60}$/).optional(),
});

/** Keeps only the executor's own settings, typed as its form declares them, or explains what is wrong. */
export function checkedLaunch(input: z.infer<typeof launchSchema>): LaunchConfig {
  const def = executorDef(input.executor);
  const settings: LaunchConfig["settings"] = {};
  for (const [key, raw] of Object.entries(input.settings)) {
    const field = def.fields.find((candidate) => candidate.key === key);
    if (!field) throw new HttpError(400, `${def.name} 没有设置项 ${key}`);
    if (raw === "") continue;
    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new HttpError(400, `${def.name}：「${field.label}」需要正整数`);
      settings[key] = value;
    } else if (field.type === "boolean") {
      if (typeof raw !== "boolean") throw new HttpError(400, `${def.name}：「${field.label}」需要开或关`);
      settings[key] = raw;
    } else settings[key] = String(raw);
  }
  if (input.executor === "local" && settings.memory !== undefined && !/^\d+(?:\.\d+)?\s*\.?\s*(?:[KMGT]B)$/i.test(String(settings.memory))) {
    throw new HttpError(400, "本机：「最多内存」写成 16.GB 这样的形式");
  }
  const launch: LaunchConfig = { ...defaultLaunchConfig(), ...input, settings, resume: false };
  if (input.executor !== "local" && launch.workDir !== "work" && !/^(?:\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(launch.workDir)) {
    throw new HttpError(400, "工作目录需要是绝对路径或对象存储地址");
  }
  const problems = launchProblems(launch);
  if (problems.length) throw new HttpError(400, problems.join("；"));
  return launch;
}
export function workflowInput(value: unknown): WorkflowDoc { return parseWorkflowDoc(workflowSchema.parse(value)); }
export const emptyProgress = (): RunProgress => ({ total: 0, pending: 0, running: 0, completed: 0, cached: 0, failed: 0, aborted: 0 });
export const active = (run: StoredExecution) => run.detail.status === "submitted" || run.detail.status === "running";
export function requireRun(id: string) { const run = store().run(id); if (!run) throw new HttpError(404, "运行不存在"); return run; }
export function runnerReady() {
  const runtime = store().runtime();
  return runtime && !runtime.error && Date.now() - runtime.heartbeat < 15_000 ? runtime : undefined;
}

/**
 * Module binaries reach remote nodes of cloud batch services and Kubernetes only through Wave,
 * so those runs put script CLIs in the project's bin/, which Nextflow ships itself.
 */
const BIN_EXECUTORS = new Set(["aws-batch", "google-batch", "azure-batch", "k8s"]);
export const scriptLayoutFor = (executor: string): ScriptLayout => (BIN_EXECUTORS.has(executor) ? "bin" : "module");

export function submitRun(body: unknown, idempotency?: string) {
  const request = z.object({ workflow: z.unknown(), params: paramsSchema, launch: launchSchema, resumeFrom: z.string().max(100).optional() }).parse(body);
  if (!runnerReady()) throw new HttpError(503, "Runner 未就绪，请先启动 pnpm runner 并检查健康状态");
  const workflow = workflowInput(request.workflow);
  if (!store().workflow(workflow.id)) throw new HttpError(400, "请先保存流程");
  workflow.params = request.params;
  const index = indexModules(store().scriptModules());
  const issues = validateWorkflow(workflow.nodes, workflow.edges, request.params, index).filter((issue) => issue.level === "error");
  if (issues.length) throw new HttpError(400, issues.map((issue) => issue.message).join("；"));
  if (new Set(workflow.nodes.map((node) => node.id)).size !== workflow.nodes.length) throw new HttpError(400, "节点 ID 重复");
  if (request.launch.resume) throw new HttpError(400, "续跑需要从运行详情选择来源记录");
  const launch = checkedLaunch(request.launch);
  // Resume: the edited canvas runs with `-resume <session>` of an earlier run of the same workflow. The launch
  // directory and work directory are stable per workflow, so unchanged steps come from the cache.
  const source = request.resumeFrom ? resumableSource(request.resumeFrom, workflow.id) : undefined;
  if (source && source.detail.launch.executor !== launch.executor) throw new HttpError(400, `续跑要用和来源运行相同的执行器（${executorDef(source.detail.launch.executor).name}）`);
  if (source) Object.assign(launch, { resume: true, workDir: source.detail.launch.workDir });
  const project = generateProject(workflow, index, { registry: launch.registry, scriptLayout: scriptLayoutFor(launch.executor) });
  const id = randomUUID();
  const lineageId = source?.lineageId ?? id;
  const root = executionDirectory(lineageId);
  const now = new Date().toISOString();
  const run: StoredExecution = {
    // Every run of a workflow launches from one directory so `-resume` can reuse any earlier session's tasks.
    lineageId, projectDir: pipelineDirectory(workflow.id), attemptDir: join(root, "attempts", id),
    ...(source ? { resumeFrom: source.detail.id, sessionId: source.sessionId } : {}),
    detail: {
      ...(source ? { resumeFromRunId: source.detail.id, nextflowSessionId: source.sessionId } : {}),
      id, runName: launch.runName ?? `studio_${id.replaceAll("-", "").slice(0, 12)}`, workflowId: workflow.id, workflowName: workflow.name,
      executor: launch.executor, profile: profileList(launch), status: "submitted", phase: "queued", submittedAt: now, progress: emptyProgress(),
      command: launchCommand(launch), launch, params: { ...request.params, outdir: join(root, "attempts", id, "results") }, runConfig: renderRunConfig(launch),
      project: { name: project.meta.name, files: project.files.map(({ path, content, executable }) => ({ path, content, ...(executable ? { executable } : {}) })) }, workflow,
    },
  };
  return store().transaction(() => {
    if (idempotency) { const existing = store().byIdempotency(idempotency); if (existing) return existing.detail; }
    store().insertRun(run, idempotency);
    return run.detail;
  });
}

/** An earlier finished run of this workflow whose session cache is still on disk. */
export function resumableSource(id: string, workflowId: string): StoredExecution {
  const source = requireRun(id);
  if (source.detail.workflowId !== workflowId) throw new HttpError(400, "只能续跑同一个流程的运行");
  if (active(source) || !source.sessionId) throw new HttpError(409, "只能续跑具有 Nextflow session 的已结束运行");
  if (source.detail.workCleanedAt) throw new HttpError(409, "这次运行的 work 目录已在磁盘页清理，不能再续跑；请重新运行");
  if (store().runs(true).some((run) => active(run) && run.lineageId === source.lineageId)) throw new HttpError(409, "同一运行链已有活动运行");
  return source;
}

/** Whether a run can be the source of a resume, for the run list. */
export const resumable = (run: StoredExecution) => !active(run) && Boolean(run.sessionId) && !run.detail.workCleanedAt;

export function cancelRun(id: string) {
  const current = requireRun(id);
  if (!active(current)) throw new HttpError(409, "运行已经结束");
  return store().updateRun(id, (run) => {
    run.cancelRequested = true;
    run.detail.cancelledAt ??= new Date().toISOString();
    if (run.detail.phase === "queued") { run.detail.status = "cancelled"; run.detail.phase = undefined; run.detail.completedAt = new Date().toISOString(); }
    else run.detail.phase = "cancelling";
  }).detail;
}

export function resumeRun(id: string) {
  const source = requireRun(id);
  if (active(source) || !source.sessionId) throw new HttpError(409, "只能恢复具有 Nextflow session 的已结束运行");
  if (source.detail.workCleanedAt) throw new HttpError(409, "这次运行的 work 目录已在磁盘页清理，不能再续跑；请重新运行");
  if (!runnerReady()) throw new HttpError(503, "Runner 未就绪");
  return store().transaction(() => {
    if (store().runs(true).some((run) => active(run) && run.lineageId === source.lineageId)) throw new HttpError(409, "同一运行链已有活动运行");
    const next = structuredClone(source);
    const newId = randomUUID();
    next.detail = { ...source.detail, id: newId, runName: `studio_${newId.replaceAll("-", "").slice(0, 12)}`, status: "submitted", phase: "queued", progress: emptyProgress(), submittedAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, cancelledAt: undefined, errorMessage: undefined, exitCode: undefined };
    next.detail.launch = { ...source.detail.launch, resume: true };
    next.detail.resumeFromRunId = id;
    next.attemptDir = join(executionDirectory(source.lineageId), "attempts", newId);
    next.detail.params = { ...next.detail.params, outdir: join(next.attemptDir, "results") };
    next.resumeFrom = id;
    delete next.pid; delete next.pidStart; delete next.owner; delete next.cancelRequested;
    store().insertRun(next);
    return next.detail;
  });
}
