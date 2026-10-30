/**
 * Deterministic fake execution used by the mock backend. A run's whole
 * timeline is derived from its workflow snapshot and timestamps, so any
 * request can compute the state "as of now" without timers or storage.
 */
import { SAMPLESHEET_ID } from "@/features/workflow/builtins";
import type { ModuleIndex } from "@/features/workflow/catalog";
import { planNodes } from "@/features/project/workflow-script";
import { findPort } from "@/features/workflow/ports";
import type { RunDetail, RunProgress, RunStatus, TaskRecord } from "./types";

export const SIM_SAMPLES = ["CONTROL_REP1", "TREATED_REP1", "TREATED_REP2"];

const STARTUP_MS = 3_000;
const SECOND = 1_000;

const LABEL_PROFILE: Record<string, { cpus: number; dur: [number, number]; mem: [number, number] }> = {
  process_single: { cpus: 1, dur: [3, 6], mem: [0.2, 1.2] },
  process_low: { cpus: 2, dur: [4, 9], mem: [0.4, 2.5] },
  process_medium: { cpus: 6, dur: [7, 14], mem: [2, 9] },
  process_high: { cpus: 12, dur: [12, 24], mem: [12, 38] },
  process_long: { cpus: 2, dur: [14, 26], mem: [1, 4] },
  process_high_memory: { cpus: 4, dur: [10, 20], mem: [40, 120] },
};

function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlannedTask {
  hash: string;
  nodeId: string;
  process: string;
  name: string;
  tag?: string;
  deps: string[];
  queueMs: number;
  durationMs: number;
  cpus: number;
  peakRss: number;
  cpuPercent: number;
  /** Set when this task is the one that fails. */
  fails?: boolean;
  submit?: number;
  start?: number;
  end?: number;
}

export interface Simulation {
  status: RunStatus;
  startedAt?: number;
  completedAt?: number;
  tasks: TaskRecord[];
  progress: RunProgress;
  errorMessage?: string;
  /** Node id of the failed task, if any. */
  failedNodeId?: string;
}

/** Builds every task with its timing; independent of "now". */
export function planTasks(run: Pick<RunDetail, "id" | "workflow" | "params">, index: ModuleIndex): PlannedTask[] {
  const rand = seededRandom(run.id);
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
  const { order, edges } = planNodes(run.workflow, index);

  const perSample = new Set<string>();
  for (const { node, def } of order) {
    // Per-sample data stays per-sample unless it lands on a collecting input (MultiQC).
    const fedPerSample = edges.some(
      (e) => e.target === node.id && perSample.has(e.source) && !findPort(def, e.targetHandle, "in")?.collect,
    );
    if (def.id === SAMPLESHEET_ID || fedPerSample) {
      perSample.add(node.id);
    }
  }

  const tasksByNode = new Map<string, PlannedTask[]>();
  const tasks: PlannedTask[] = [];
  for (const { node, def } of order) {
    if (def.builtin) continue;
    const upstream = edges.filter((e) => e.target === node.id).map((e) => e.source);
    const label = node.data.config.label ?? def.label ?? "process_single";
    const profile = LABEL_PROFILE[label] ?? LABEL_PROFILE.process_single;
    const samples = perSample.has(node.id) ? SIM_SAMPLES : [undefined];
    const nodeTasks = samples.map((sample) => {
      const deps = upstream.flatMap((src) => {
        const srcTasks = tasksByNode.get(src) ?? [];
        if (sample && perSample.has(src)) return srcTasks.filter((t) => t.tag === sample).map((t) => t.hash);
        return srcTasks.map((t) => t.hash);
      });
      const [lo, hi] = profile.dur;
      const [mlo, mhi] = profile.mem;
      const tag = sample ?? (def.id === "nf-core/multiqc" ? undefined : node.data.alias.toLowerCase());
      const task: PlannedTask = {
        hash: `${hex(2)}/${hex(6)}`,
        nodeId: node.id,
        process: node.data.alias,
        name: tag ? `${node.data.alias} (${tag})` : node.data.alias,
        tag,
        deps: [...new Set(deps)],
        queueMs: (0.4 + rand() * 1.6) * SECOND,
        durationMs: (lo + rand() * (hi - lo)) * SECOND,
        cpus: profile.cpus,
        peakRss: Math.round((mlo + rand() * (mhi - mlo)) * 1024 ** 3),
        cpuPercent: Math.round(profile.cpus * 100 * (0.55 + rand() * 0.4) * 10) / 10,
      };
      return task;
    });
    tasksByNode.set(node.id, nodeTasks);
    tasks.push(...nodeTasks);
  }

  // `--simulate_failure` makes the heaviest per-sample task fail, so error
  // handling can be exercised without a real backend.
  if (run.params.simulate_failure === true && tasks.length) {
    const victim = [...tasks].filter((t) => t.tag && SIM_SAMPLES.includes(t.tag)).sort((a, b) => b.cpus - a.cpus)[0] ?? tasks[0];
    victim.fails = true;
  }
  return tasks;
}

/** Resolves start/end times, honouring dependencies, failure and cancellation. */
function schedule(tasks: PlannedTask[], startedAt: number, cancelledAt?: number) {
  const byHash = new Map(tasks.map((t) => [t.hash, t]));
  let failedAt: number | undefined;
  for (const t of tasks) {
    const deps = t.deps.map((h) => byHash.get(h)!);
    if (deps.some((d) => d.end === undefined || d.fails)) continue; // upstream never finished
    const ready = Math.max(startedAt, ...deps.map((d) => d.end!));
    // errorStrategy 'finish': after a failure nothing new is submitted.
    if (failedAt !== undefined && ready >= failedAt) continue;
    if (cancelledAt !== undefined && ready >= cancelledAt) continue;
    t.submit = ready;
    t.start = ready + t.queueMs;
    t.end = t.start + (t.fails ? t.durationMs * 0.6 : t.durationMs);
    if (t.fails) failedAt = Math.min(failedAt ?? Infinity, t.end);
  }
  // Tasks scheduled before the failure was known still run; later ones don't.
  if (failedAt !== undefined) {
    for (const t of tasks) {
      if (t.submit !== undefined && t.submit > failedAt) t.submit = t.start = t.end = undefined;
    }
  }
  return failedAt;
}

export function simulateRun(
  run: Pick<RunDetail, "id" | "workflow" | "params" | "submittedAt" | "cancelledAt" | "launch">,
  index: ModuleIndex,
  now = Date.now(),
): Simulation {
  const submittedAt = Date.parse(run.submittedAt);
  const cancelledAt = run.cancelledAt ? Date.parse(run.cancelledAt) : undefined;
  const startedAt = submittedAt + STARTUP_MS;
  const tasks = planTasks(run, index);
  const failedAt = schedule(tasks, startedAt, cancelledAt);
  const workDir = run.launch.workDir || "work";

  const records: TaskRecord[] = tasks.map((t) => {
    const iso = (ms?: number) => (ms !== undefined && ms <= now ? new Date(ms).toISOString() : undefined);
    let status: TaskRecord["status"] = "pending";
    if (t.submit !== undefined && now >= t.submit) status = "submitted";
    if (t.start !== undefined && now >= t.start) status = "running";
    if (t.end !== undefined && now >= t.end) status = t.fails ? "failed" : "completed";
    // Tasks still in flight when the run was stopped are killed, not finished.
    const killed = cancelledAt !== undefined && now >= cancelledAt && t.submit !== undefined && t.end! > cancelledAt;
    if (killed) status = "aborted";
    const done = status === "completed" || status === "failed";
    return {
      hash: t.hash,
      nodeId: t.nodeId,
      process: t.process,
      name: t.name,
      tag: t.tag,
      status,
      submittedAt: iso(t.submit),
      startedAt: status === "submitted" || status === "pending" || (killed && t.start! > cancelledAt!) ? undefined : iso(t.start),
      completedAt: done ? iso(t.end) : undefined,
      durationMs: done ? Math.round(t.end! - t.start!) : undefined,
      cpus: t.cpus,
      peakRss: done ? t.peakRss : status === "running" ? Math.round(t.peakRss * 0.6) : undefined,
      cpuPercent: done || status === "running" ? t.cpuPercent : undefined,
      exitStatus: status === "completed" ? 0 : status === "failed" ? 1 : undefined,
      workdir: `${workDir}/${t.hash}${"0".repeat(24)}`,
    };
  });

  const progress: RunProgress = { total: records.length, pending: 0, running: 0, completed: 0, cached: 0, failed: 0, aborted: 0 };
  for (const r of records) {
    if (r.status === "pending" || r.status === "submitted") progress.pending++;
    else if (r.status === "running") progress.running++;
    else if (r.status === "completed") progress.completed++;
    else if (r.status === "cached") progress.cached++;
    else if (r.status === "failed") progress.failed++;
    else if (r.status === "aborted") progress.aborted++;
  }

  const lastEnd = Math.max(startedAt, ...tasks.filter((t) => t.end !== undefined).map((t) => t.end!));
  let status: RunStatus = now < startedAt ? "submitted" : "running";
  let completedAt: number | undefined;
  let errorMessage: string | undefined;
  const failedTask = tasks.find((t) => t.fails && t.end !== undefined);

  if (cancelledAt !== undefined && now >= cancelledAt && (failedAt === undefined || cancelledAt < failedAt)) {
    status = "cancelled";
    completedAt = cancelledAt;
    errorMessage = "运行已被手动停止";
  } else if (failedAt !== undefined && now >= lastEnd + SECOND) {
    status = "failed";
    completedAt = lastEnd + SECOND;
    errorMessage = `Process \`${failedTask?.name}\` terminated with an error exit status (1)`;
  } else if (failedAt === undefined && now >= lastEnd + SECOND && now >= startedAt) {
    status = "succeeded";
    completedAt = lastEnd + SECOND;
  }

  return {
    status,
    startedAt: now >= startedAt ? startedAt : undefined,
    completedAt,
    tasks: records,
    progress,
    errorMessage,
    failedNodeId: status === "failed" ? failedTask?.nodeId : undefined,
  };
}
