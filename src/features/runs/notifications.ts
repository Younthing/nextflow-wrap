import type { RunStatus, RunSummary } from "./types";

export interface RunNotice { runId: string; title: string; body: string; status: RunStatus }

const FINISHED: Partial<Record<RunStatus, string>> = {
  succeeded: "运行完成",
  failed: "运行失败",
  interrupted: "运行中断",
};

const ACTIVE: RunStatus[] = ["submitted", "running"];

/**
 * Runs that finished since the previous poll. Only a run seen active before counts, so opening the app on a
 * history of finished runs notifies nothing, and a run the user cancelled is not announced back to them.
 */
export function finishedSince(previous: ReadonlyMap<string, RunStatus>, current: readonly RunSummary[]): RunNotice[] {
  const notices: RunNotice[] = [];
  for (const run of current) {
    const before = previous.get(run.id);
    const title = FINISHED[run.status];
    if (!before || !ACTIVE.includes(before) || !title) continue;
    const tasks = run.progress.total ? `，${run.progress.completed + run.progress.cached}/${run.progress.total} 个任务` : "";
    notices.push({
      runId: run.id,
      status: run.status,
      title: `${title}：${run.workflowName}`,
      body: run.status === "succeeded" ? `${run.runName}${tasks}` : run.errorMessage?.slice(0, 160) || `${run.runName}${tasks}`,
    });
  }
  return notices;
}

export const statusMap = (runs: readonly RunSummary[]) => new Map(runs.map((run) => [run.id, run.status]));
