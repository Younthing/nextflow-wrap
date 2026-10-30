import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import catalog from "@/data/nf-core-modules.json";
import { generateProject } from "@/features/project/generate";
import { defaultLaunchConfig, launchCommand, profileList, renderRunConfig } from "@/features/project/launch";
import { indexModules } from "@/features/workflow/catalog";
import { parseWorkflowDoc } from "@/features/workflow/document";
import type { ModuleCatalog, WorkflowDoc } from "@/features/workflow/types";
import { validateWorkflow } from "@/features/workflow/validate";
import { dataDirectory, store, type StoredExecution } from "@/lib/server/database";
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
  nodes: z.array(z.object({ id: z.string().min(1).max(100), position: z.object({ x: z.number(), y: z.number() }), data: z.object({ moduleId: z.string(), alias: z.string().regex(/^[A-Z][A-Z0-9_]*$/), widgets: z.record(z.string(), scalar), config: z.object({ args: z.string().optional(), prefix: z.string().optional(), label: z.string().optional(), publish: z.boolean().optional() }), settings: z.record(z.string(), scalar).optional(), disabled: z.boolean().optional() }) })).max(500),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), sourceHandle: z.string(), targetHandle: z.string() })).max(2000),
});
const launchSchema = z.object({
  executor: z.literal("local"), engine: z.literal("docker"), settings: z.object({ cpus: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().min(1).max(64).optional()), memory: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^\d+(?:\.\d+)?\s*\.?\s*(?:[KMGT]B)$/i).optional()) }),
  extraProfiles: z.array(z.enum(["test", "debug", "emulate_amd64"])), workDir: z.string(), resume: z.boolean(), registry: z.enum(["quay.io", "docker.rainbond.cc"]), runName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,60}$/).optional(),
});
export function workflowInput(value: unknown): WorkflowDoc { return parseWorkflowDoc(workflowSchema.parse(value)); }
export const emptyProgress = (): RunProgress => ({ total: 0, pending: 0, running: 0, completed: 0, cached: 0, failed: 0, aborted: 0 });
export const active = (run: StoredExecution) => run.detail.status === "submitted" || run.detail.status === "running";
export function requireRun(id: string) { const run = store().run(id); if (!run) throw new HttpError(404, "运行不存在"); return run; }
export function runnerReady() {
  const runtime = store().runtime();
  return runtime && !runtime.error && Date.now() - runtime.heartbeat < 15_000 ? runtime : undefined;
}

export function submitRun(body: unknown, idempotency?: string) {
  const request = z.object({ workflow: z.unknown(), params: paramsSchema, launch: launchSchema, modulesSha: z.string().optional() }).parse(body);
  if (!runnerReady()) throw new HttpError(503, "Runner 未就绪，请先启动 pnpm runner 并检查健康状态");
  if (request.modulesSha && request.modulesSha !== catalog.gitSha) throw new HttpError(409, "模块目录版本已变更，请刷新页面");
  const workflow = workflowInput(request.workflow);
  if (!store().workflow(workflow.id)) throw new HttpError(400, "请先保存流程");
  workflow.params = request.params;
  const index = indexModules((catalog as ModuleCatalog).modules);
  const issues = validateWorkflow(workflow.nodes, workflow.edges, request.params, index).filter((issue) => issue.level === "error");
  if (issues.length) throw new HttpError(400, issues.map((issue) => issue.message).join("；"));
  if (new Set(workflow.nodes.map((node) => node.id)).size !== workflow.nodes.length) throw new HttpError(400, "节点 ID 重复");
  if (request.launch.resume) throw new HttpError(400, "续跑需要从运行详情选择来源记录");
  const launch = { ...defaultLaunchConfig(), ...request.launch, resume: false };
  const project = generateProject(workflow, index, { modulesSha: catalog.gitSha, registry: launch.registry });
  const id = randomUUID();
  const root = join(dataDirectory(), "executions", id);
  const now = new Date().toISOString();
  const run: StoredExecution = {
    lineageId: id, projectDir: join(root, "project"), attemptDir: join(root, "attempts", id),
    detail: {
      id, runName: launch.runName ?? `studio_${id.replaceAll("-", "").slice(0, 12)}`, workflowId: workflow.id, workflowName: workflow.name,
      executor: "local", profile: profileList(launch), status: "submitted", phase: "queued", submittedAt: now, progress: emptyProgress(),
      command: launchCommand(launch), launch, params: { ...request.params, outdir: join(root, "attempts", id, "results") }, runConfig: renderRunConfig(launch),
      project: { name: project.meta.name, files: project.files, components: project.components }, workflow,
    },
  };
  return store().transaction(() => {
    if (idempotency) { const existing = store().byIdempotency(idempotency); if (existing) return existing.detail; }
    store().insertRun(run, idempotency);
    return run.detail;
  });
}

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
  if (!runnerReady()) throw new HttpError(503, "Runner 未就绪");
  return store().transaction(() => {
    if (store().runs(true).some((run) => active(run) && run.lineageId === source.lineageId)) throw new HttpError(409, "同一运行链已有活动运行");
    const next = structuredClone(source);
    const newId = randomUUID();
    next.detail = { ...source.detail, id: newId, runName: `studio_${newId.replaceAll("-", "").slice(0, 12)}`, status: "submitted", phase: "queued", progress: emptyProgress(), submittedAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, cancelledAt: undefined, errorMessage: undefined, exitCode: undefined };
    next.detail.launch = { ...source.detail.launch, resume: true };
    next.detail.resumeFromRunId = id;
    next.attemptDir = join(dataDirectory(), "executions", source.lineageId, "attempts", newId);
    next.detail.params = { ...next.detail.params, outdir: join(next.attemptDir, "results") };
    next.resumeFrom = id;
    delete next.pid; delete next.pidStart; delete next.owner; delete next.cancelRequested;
    store().insertRun(next);
    return next.detail;
  });
}
