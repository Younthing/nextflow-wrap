import type { StoredExecution } from "@/lib/server/database";

/**
 * Runs share slots by where their tasks execute.
 * A local run's tasks use this machine, so local runs go one at a time.
 * On a cluster or cloud the Nextflow head is only a light JVM that submits jobs,
 * so several such runs may be active at once.
 */
export type SlotClass = "local" | "remote";
export type SlotLimits = Record<SlotClass, number>;

export const slotClass = (run: StoredExecution): SlotClass => run.detail.launch.executor === "local" ? "local" : "remote";

export function slotLimits(env: Partial<Record<string, string>> = process.env): SlotLimits {
  const remote = Number(env.NEXTFLOW_STUDIO_REMOTE_SLOTS ?? 4);
  return { local: 1, remote: Number.isInteger(remote) && remote >= 1 ? Math.min(remote, 64) : 4 };
}

const queued = (run: StoredExecution) => run.detail.status === "submitted" && run.detail.phase === "queued";
const occupying = (run: StoredExecution) => (run.detail.status === "submitted" || run.detail.status === "running") && !queued(run);

/** The oldest queued run whose slot class has room, or undefined. Each class is FIFO on its own. */
export function nextQueued(runs: readonly StoredExecution[], limits: SlotLimits): StoredExecution | undefined {
  const used: SlotLimits = { local: 0, remote: 0 };
  for (const run of runs) if (occupying(run)) used[slotClass(run)]++;
  return [...runs]
    .filter(queued)
    .sort((a, b) => a.detail.submittedAt.localeCompare(b.detail.submittedAt))
    .find((run) => used[slotClass(run)] < limits[slotClass(run)]);
}

/**
 * Outcome of a run from the launch directory's `.nextflow/history`.
 * The runner reads this when it takes over a run whose exit code it never saw.
 * Columns: timestamp, duration, run name, status (OK/ERR/-), revision, session id, command.
 */
export function historyStatus(history: string, runName: string): "OK" | "ERR" | undefined {
  for (const line of history.trim().split("\n").reverse()) {
    const columns = line.split("\t");
    if (columns[2] !== runName) continue;
    return columns[3] === "OK" ? "OK" : columns[3] === "ERR" ? "ERR" : undefined;
  }
  return undefined;
}
