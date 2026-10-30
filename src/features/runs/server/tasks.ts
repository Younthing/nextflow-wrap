import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StudioStore, StoredExecution } from "@/lib/server/database";
import type { TaskRecord, TaskStatus } from "../types";
import { emptyProgress } from "./service";

const statuses: Record<string, TaskStatus> = { NEW: "pending", SUBMITTED: "submitted", RUNNING: "running", COMPLETED: "completed", CACHED: "cached", FAILED: "failed", ABORTED: "aborted" };
const rank: Record<TaskStatus, number> = { pending: 0, submitted: 1, running: 2, completed: 3, cached: 3, failed: 3, aborted: 3 };
const number = (value: unknown) => value === null || value === undefined || value === "-" || value === "" ? undefined : Number.isFinite(Number(value)) ? Number(value) : undefined;
const time = (value: unknown) => {
  const numeric = number(value);
  if (numeric !== undefined) return new Date(numeric).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
};

export function taskFromTrace(run: StoredExecution, trace: Record<string, unknown>, event?: string): TaskRecord | undefined {
  const taskId = String(trace.task_id ?? "");
  if (!taskId) return undefined;
  const processName = String(trace.process ?? trace.name ?? "").split(" (")[0];
  const alias = processName.split(":").at(-1);
  const node = run.detail.workflow.nodes.find((node) => node.data.alias === alias);
  const status = statuses[String(trace.status)] ?? ({ process_submitted: "submitted", process_started: "running", process_completed: "completed" } as const)[event as "process_started"];
  if (!status) return undefined;
  const attempt = number(trace.attempt) ?? 1;
  return {
    id: `${taskId}:${attempt}`, taskId, attempt, hash: String(trace.hash ?? `task-${taskId}`), nodeId: node?.id ?? "system", process: processName,
    name: String(trace.name ?? processName), tag: trace.tag ? String(trace.tag) : undefined, status,
    submittedAt: time(trace.submit), startedAt: time(trace.start), completedAt: time(trace.complete),
    durationMs: number(trace.duration), cpus: number(trace.cpus) ?? 1, peakRss: number(trace.peak_rss), cpuPercent: number(trace["%cpu"]), exitStatus: number(trace.exit), workdir: String(trace.workdir ?? ""),
  };
}

export function upsertTrace(db: StudioStore, run: StoredExecution, trace: Record<string, unknown>, event?: string) {
  const task = taskFromTrace(run, trace, event);
  if (!task) return;
  const previous = db.tasks(run.detail.id).find((item) => item.id === task.id);
  if (previous && rank[previous.status] > rank[task.status]) return;
  const defined = Object.fromEntries(Object.entries(task).filter(([, value]) => value !== undefined));
  if (previous && !trace.workdir) defined.workdir = previous.workdir;
  if (previous && !trace.hash) defined.hash = previous.hash;
  if (previous && trace.cpus === undefined) defined.cpus = previous.cpus;
  db.putTask(run.detail.id, { ...previous, ...defined } as TaskRecord);
}

export function refreshProgress(db: StudioStore, id: string) {
  const latest: TaskRecord[] = [];
  // Nextflow allocates a new task_id for a retry. A shared tag alone does not
  // identify a task: scatter processes can legitimately have repeated tags.
  const tasks = db.tasks(id).sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1) || Number(a.taskId ?? 0) - Number(b.taskId ?? 0));
  for (const task of tasks) {
    const retryOf = (task.attempt ?? 1) > 1 ? latest.findIndex((previous) => previous.process === task.process && previous.name === task.name && previous.status === "failed" && (previous.attempt ?? 1) === task.attempt! - 1) : -1;
    if (retryOf >= 0) latest[retryOf] = task;
    else latest.push(task);
  }
  const progress = emptyProgress();
  for (const task of latest) {
    progress.total++;
    if (task.status === "submitted" || task.status === "pending") progress.pending++;
    else progress[task.status]++;
  }
  db.updateRun(id, (run) => { run.detail.progress = progress; });
}

export function ingestEvent(db: StudioStore, id: string, value: unknown) {
  const event = value as { event?: string; runId?: string; trace?: Record<string, unknown>; metadata?: { workflow?: { sessionId?: string } } };
  if (!event || typeof event !== "object" || typeof event.event !== "string") throw new Error("Invalid Nextflow event");
  const run = db.run(id);
  if (!run || !["submitted", "running"].includes(run.detail.status)) return;
  if (!db.event(id, createHash("sha256").update(JSON.stringify(event)).digest("hex"), event)) return;
  if (event.runId) db.updateRun(id, (record) => { record.sessionId = event.runId; record.detail.nextflowSessionId = event.runId; });
  if (event.trace) upsertTrace(db, run, event.trace, event.event);
  refreshProgress(db, id);
}

export async function reconcileTrace(db: StudioStore, run: StoredExecution) {
  const text = await readFile(join(run.attemptDir, "trace.tsv"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const [header, ...rows] = text.trim().split("\n");
  const fields = header.split("\t");
  for (const row of rows) {
    const values = row.split("\t");
    if (values.length === fields.length) upsertTrace(db, run, Object.fromEntries(fields.map((field, index) => [field, values[index]])));
  }
  refreshProgress(db, run.detail.id);
}
