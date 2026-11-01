import { delay, http, HttpResponse } from "msw";

import { randomRunName } from "@/features/runs/names";
import { consoleLog, resultContent, resultFiles, taskLog } from "@/features/runs/outputs";
import { simulateRun } from "@/features/runs/simulate";
import type { LaunchRequest, RunDetail, RunSummary } from "@/features/runs/types";
import { indexModules, resolveNodeDef } from "@/features/workflow/catalog";
import { newId } from "@/features/workflow/nodes";
import { profileList } from "@/features/project/launch";
import { readDb, writeDb, type StoredRun } from "./db";
import { sampleAnnDataSummary } from "@/features/runs/anndata";

function moduleIndex() {
  return indexModules(Object.values(readDb().scriptModules));
}

function simulate(run: StoredRun, now = Date.now()) {
  const sim = simulateRun(run, moduleIndex(), now);
  return { sim, detail: materialize(run, now, sim) };
}

export function materialize(run: StoredRun, now = Date.now(), sim = simulateRun(run, moduleIndex(), now)): RunDetail {
  const iso = (ms?: number) => (ms !== undefined && ms <= now ? new Date(ms).toISOString() : undefined);
  return {
    ...run,
    status: sim.status,
    progress: sim.progress,
    startedAt: iso(sim.startedAt),
    completedAt: iso(sim.completedAt),
    errorMessage: sim.status === "failed" || sim.status === "cancelled" ? sim.errorMessage : undefined,
  };
}

export function summarize(run: RunDetail): RunSummary {
  return {
    id: run.id,
    runName: run.runName,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    executor: run.executor,
    profile: run.profile,
    submittedAt: run.submittedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    progress: run.progress,
    errorMessage: run.errorMessage,
  };
}

const notFound = () => HttpResponse.json({ message: "运行不存在" }, { status: 404 });

export const runHandlers = [
  http.get("/api/runs", async ({ request }) => {
    await delay(100);
    const workflowId = new URL(request.url).searchParams.get("workflowId");
    const runs = Object.values(readDb().runs)
      .filter((r) => !workflowId || r.workflowId === workflowId)
      .map((r) => { const summary = summarize(materialize(r)); return { ...summary, resumable: summary.status === "succeeded" || summary.status === "failed" }; })
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return HttpResponse.json(runs);
  }),

  http.post("/api/runs", async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as LaunchRequest;
    const runName = body.launch.runName || randomRunName(Object.values(readDb().runs).map((r) => r.runName));
    const run: StoredRun = {
      id: newId("run"),
      runName,
      workflowId: body.workflow.id,
      workflowName: body.workflow.name,
      executor: body.launch.executor,
      profile: profileList(body.launch),
      submittedAt: new Date().toISOString(),
      command: body.command.includes("-name ") ? body.command : `${body.command} \\\n    -name ${runName}`,
      launch: { ...body.launch, runName },
      params: body.params,
      runConfig: body.runConfig,
      project: body.project,
      workflow: body.workflow,
      ...(body.resumeFrom ? { resumeFromRunId: body.resumeFrom } : {}),
    };
    writeDb((db) => {
      db.runs[run.id] = run;
    });
    return HttpResponse.json(materialize(run), { status: 201 });
  }),

  http.get("/api/runs/:id", async ({ params }) => {
    await delay(80);
    const run = readDb().runs[params.id as string];
    return run ? HttpResponse.json(materialize(run)) : notFound();
  }),

  http.get("/api/runs/:id/tasks", async ({ params }) => {
    await delay(60);
    const run = readDb().runs[params.id as string];
    return run ? HttpResponse.json(simulate(run).sim.tasks) : notFound();
  }),

  http.get("/api/runs/:id/log", async ({ params }) => {
    await delay(60);
    const run = readDb().runs[params.id as string];
    if (!run) return notFound();
    const { sim, detail } = simulate(run);
    return HttpResponse.json({ lines: consoleLog(detail, sim.tasks) });
  }),

  http.get("/api/runs/:id/task-log", async ({ params, request }) => {
    const run = readDb().runs[params.id as string];
    if (!run) return notFound();
    const hash = new URL(request.url).searchParams.get("hash");
    const task = simulate(run).sim.tasks.find((t) => t.hash === hash);
    if (!task) return HttpResponse.json({ message: "任务不存在" }, { status: 404 });
    const node = run.workflow.nodes.find((n) => n.id === task.nodeId);
    return HttpResponse.json({ text: taskLog(task, node && resolveNodeDef(moduleIndex(), node.data)) });
  }),

  http.get("/api/runs/:id/results", async ({ params }) => {
    await delay(80);
    const run = readDb().runs[params.id as string];
    if (!run) return notFound();
    const { sim, detail } = simulate(run);
    return HttpResponse.json(resultFiles(detail, sim.tasks, moduleIndex()));
  }),

  http.get("/api/runs/:id/results/content", async ({ params, request }) => {
    await delay(120);
    const run = readDb().runs[params.id as string];
    if (!run) return notFound();
    const { sim, detail } = simulate(run);
    const path = new URL(request.url).searchParams.get("path") ?? "";
    const content = resultContent(detail, sim.tasks, moduleIndex(), path);
    if (!content) return HttpResponse.json({ message: "文件不存在或无法预览" }, { status: 404 });
    const body = content.encoding === "base64" ? Uint8Array.from(atob(content.body), (char) => char.charCodeAt(0)) : content.body;
    return new HttpResponse(body, { headers: { "content-type": content.contentType } });
  }),

  http.get("/api/runs/:id/results/summary", async ({ params, request }) => {
    await delay(150);
    if (!readDb().runs[params.id as string]) return notFound();
    const path = new URL(request.url).searchParams.get("path") ?? "";
    if (!path.endsWith(".h5ad")) return HttpResponse.json({ message: "只有 .h5ad 文件有摘要" }, { status: 400 });
    return HttpResponse.json(sampleAnnDataSummary(path));
  }),

  http.post("/api/runs/:id/cancel", async ({ params }) => {
    const run = readDb().runs[params.id as string];
    if (!run) return notFound();
    const current = materialize(run);
    if (current.status !== "submitted" && current.status !== "running") {
      return HttpResponse.json({ message: "运行已经结束，无法停止" }, { status: 409 });
    }
    writeDb((db) => {
      db.runs[run.id] = { ...run, cancelledAt: new Date().toISOString() };
    });
    return HttpResponse.json(materialize(readDb().runs[run.id]));
  }),

  http.delete("/api/runs/:id", ({ params }) => {
    const id = params.id as string;
    if (!readDb().runs[id]) return notFound();
    writeDb((db) => {
      delete db.runs[id];
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
