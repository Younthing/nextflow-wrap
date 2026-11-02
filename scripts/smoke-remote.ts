import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLaunchConfig } from "@/features/project/launch";
import type { RemoteProbe } from "@/features/remote/types";
import type { ResultFile } from "@/features/runs/outputs";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import type { SettingsView } from "@/features/settings/types";
import type { WorkflowDoc } from "@/features/workflow/types";

/**
 * Cluster runs through the real web server and runner. Start both with NEXTFLOW_STUDIO_SSH=scripts/ssh-shim.sh
 * (and NEXTFLOW_STUDIO_REMOTE_POLL_MS=1000 to keep it quick): the shim runs every "remote" command on this machine,
 * so the runner's whole cluster path runs against the real Nextflow: upload, nohup launch on the "login node",
 * polling, task logs over ssh, results fetched back, resume from the cluster's cache, and stop.
 */
const base = process.env.STUDIO_API_URL ?? "http://127.0.0.1:3000/api";
async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", origin: new URL(base).origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`);
  return value as T;
}
async function wait(id: string, predicate: (run: RunDetail, tasks: TaskRecord[]) => boolean, allowEnd = false) {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const [run, tasks] = await Promise.all([api<RunDetail>(`/runs/${id}`), api<TaskRecord[]>(`/runs/${id}/tasks`)]);
    if (predicate(run, tasks)) return { run, tasks };
    if (!allowEnd && !["running", "submitted"].includes(run.status)) throw new Error(`Unexpected terminal run: ${run.status} ${run.errorMessage ?? ""}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${id}`);
}

async function main() {
  const cluster = mkdtempSync(join(tmpdir(), "studio-cluster-"));
  const host = { id: "smoke-cluster", name: "模拟集群", host: "localhost", baseDir: cluster };
  const probe = await api<RemoteProbe>("/remotes/test", host);
  assert.ok(probe.ok, probe.error);
  console.log(`Connection test: ${probe.nextflow} in ${probe.baseDir}`);
  const view = await api<SettingsView>("/settings");
  await api<SettingsView>("/settings", { settings: { ...view.settings, remotes: [...view.settings.remotes.filter((candidate) => candidate.id !== host.id), host] } }, "PUT");

  const source = await api<WorkflowDoc>("/workflows/hostchain");
  const workflow = await api<WorkflowDoc>("/workflows", { ...source, id: "", name: "集群执行验收" });
  const body = { workflow, params: workflow.params, launch: { ...defaultLaunchConfig(), remote: host.id, settings: { cpus: 2, memory: "2.GB" } } };
  const first = await api<RunDetail>("/runs", body);
  assert.equal(first.remoteHost, "模拟集群");
  await wait(first.id, (_, tasks) => tasks.some((task) => task.status === "running" || task.status === "completed"));
  console.log(`Run ${first.id} is executing on the cluster`);
  const done = await wait(first.id, (run) => run.status === "succeeded");
  assert.ok(done.tasks.length > 10, `only ${done.tasks.length} tasks`);
  assert.ok(done.run.remote?.launchDir.startsWith(cluster), JSON.stringify(done.run.remote));
  assert.equal(done.run.launch.workDir, join(cluster, "work"));
  assert.ok(done.run.nextflowSessionId, "session id from the cluster's history");
  const files = await api<ResultFile[]>(`/runs/${first.id}/results`);
  const count = files.find((file) => file.path.endsWith("count/out.txt"));
  assert.ok(count, "results came back");
  assert.equal((await (await fetch(`${base}/runs/${first.id}/results/content?path=${encodeURIComponent(count.path)}`)).text()).trim(), "3");
  const task = done.tasks.find((candidate) => candidate.status === "completed")!;
  const log = await api<{ text: string }>(`/runs/${first.id}/task-log?hash=${encodeURIComponent(task.id ?? task.hash)}`);
  assert.match(log.text, /--- \.command\.sh ---/);
  console.log(`Succeeded with ${done.tasks.length} tasks; results fetched back; task log read over ssh`);

  const resumed = await api<RunDetail>(`/runs/${first.id}/resume`, {});
  const cached = await wait(resumed.id, (run) => run.status === "succeeded");
  assert.equal(cached.tasks.filter((candidate) => candidate.status === "cached" && candidate.nodeId === "sort").length, 2);
  console.log(`Resume ${resumed.id}: both SORT tasks cached on the cluster`);

  const stoppable = await api<RunDetail>("/runs", body);
  await wait(stoppable.id, (run, tasks) => Boolean(run.remote?.pid) && tasks.length > 0);
  await api(`/runs/${stoppable.id}/cancel`, {});
  await wait(stoppable.id, (run) => run.status === "cancelled", true);
  console.log(`Stopped ${stoppable.id} on the cluster`);
  console.log(JSON.stringify({ succeeded: true, runId: first.id, resumeId: resumed.id, cancelledId: stoppable.id, cluster }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
