import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultLaunchConfig } from "@/features/project/launch";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import type { ResultFile } from "@/features/runs/outputs";
import type { WorkflowDoc } from "@/features/workflow/types";

const base = process.env.STUDIO_API_URL ?? "http://127.0.0.1:3000/api";
async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`);
  return value as T;
}
async function wait(id: string, predicate: (run: RunDetail, tasks: TaskRecord[]) => boolean) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const [run, tasks] = await Promise.all([api<RunDetail>(`/runs/${id}`), api<TaskRecord[]>(`/runs/${id}/tasks`)]);
    if (predicate(run, tasks)) return { run, tasks };
    if (!["running", "submitted"].includes(run.status)) throw new Error(`Unexpected terminal run: ${JSON.stringify(run)}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${id}`);
}
async function main() {
  const health = await api<{ mocked: boolean; runnerReady: boolean }>("/health");
  assert.equal(health.mocked, false); assert.equal(health.runnerReady, true);
  const source = await api<WorkflowDoc>("/workflows/qc-smoke");
  const workflow = await api<WorkflowDoc>("/workflows", { ...source, id: "", name: "真实执行验收" });
  const body = { workflow, params: workflow.params, launch: { ...defaultLaunchConfig(), settings: { cpus: 2, memory: "2.GB" } } };
  const key = randomUUID();
  const [first, duplicate] = await Promise.all([api<RunDetail>("/runs", body, key), api<RunDetail>("/runs", body, key)]);
  assert.equal(first.id, duplicate.id);
  console.log(`Submitted ${first.id}; concurrent duplicate was deduplicated`);
  await wait(first.id, (_, tasks) => tasks.some((task) => task.status === "running"));
  const completed = await wait(first.id, (run) => run.status === "succeeded");
  assert.equal(completed.tasks.length, 3);
  assert.ok(completed.tasks.every((task) => task.status === "completed" && task.exitStatus === 0));
  assert.ok(completed.run.nextflowSessionId);
  const files = await api<ResultFile[]>(`/runs/${first.id}/results`);
  const dataPath = files.find((file) => file.path.endsWith("multiqc_fastqc.txt"))?.path;
  assert.ok(dataPath);
  const data = await (await fetch(`${base}/runs/${first.id}/results/content?path=${encodeURIComponent(dataPath)}`)).text();
  for (const sample of ["SINGLE", "PAIRED_1", "PAIRED_2"]) assert.ok(data.includes(sample));
  const escape = await fetch(`${base}/runs/${first.id}/results/content?path=..%2Fparams.json`);
  assert.equal(escape.status, 403);
  const resumed = await api<RunDetail>(`/runs/${first.id}/resume`, {});
  const cached = await wait(resumed.id, (run) => run.status === "succeeded");
  assert.equal(cached.tasks.filter((task) => task.status === "cached" && task.nodeId === "fastqc").length, 2);
  console.log(`Resume ${resumed.id}: both FastQC tasks cached`);
  const cancellable = await api<RunDetail>("/runs", body, randomUUID());
  await wait(cancellable.id, (_, tasks) => tasks.some((task) => task.status === "running"));
  await api(`/runs/${cancellable.id}/cancel`, {});
  await wait(cancellable.id, (run) => run.status === "cancelled");
  console.log(`Cancelled active computation ${cancellable.id}`);
  const failed = await api<RunDetail>("/runs", { ...body, params: { ...workflow.params, input: "/nonexistent/nextflow-studio/samplesheet.csv" } }, randomUUID());
  await wait(failed.id, (run) => run.status === "failed");
  console.log(`Verified missing-input failure ${failed.id}`);
  console.log(JSON.stringify({ succeeded: true, runId: first.id, resumeId: resumed.id, cancelledId: cancellable.id, failedId: failed.id, ui: base.replace(/\/api$/, "") + `/runs/${first.id}` }, null, 2));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
