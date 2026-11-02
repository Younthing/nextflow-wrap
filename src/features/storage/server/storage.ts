import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "@/features/runs/server/service";
import { store, type StudioStore } from "@/lib/server/database";
import { condaCacheDirectory, dataDirectory, singularityCacheDirectory, workDirectory } from "@/lib/server/paths";
import type { CacheUsage, CleanupResult, SessionUsage, StorageReport } from "../types";
import { groupSessions, localWorkRoot, planCleanup, taskDirectory } from "./plan";
import { directorySize } from "./usage";

/** Usage per Nextflow session plus the shared caches. Sizes are walked live, with a file budget. */
export async function storageReport(db: StudioStore = store()): Promise<StorageReport> {
  const runs = db.runs(true);
  const budget = { files: 500_000 };
  const sessions: SessionUsage[] = [];
  for (const group of groupSessions(runs)) {
    const latest = group.runs.at(-1)!;
    let workBytes = 0;
    let reclaimable = 0;
    let workDirs = 0;
    let remote = false;
    const seen = new Set<string>();
    for (const run of group.runs) {
      const root = localWorkRoot(run);
      if (!root) { remote = true; continue; }
      for (const task of db.tasks(run.detail.id)) {
        const dir = taskDirectory(root, task.workdir);
        if (!dir || seen.has(dir) || !existsSync(dir)) continue;
        seen.add(dir);
        const size = await directorySize(dir, budget);
        workDirs++;
        workBytes += size.bytes;
        reclaimable += size.reclaimable;
      }
    }
    let resultBytes = 0;
    for (const run of group.runs) resultBytes += (await directorySize(join(run.attemptDir, "results"), budget)).bytes;
    sessions.push({
      key: group.key,
      sessionId: group.runs.find((run) => run.sessionId)?.sessionId,
      workflowId: latest.detail.workflowId,
      workflowName: latest.detail.workflowName,
      runs: group.runs.map((run) => ({ id: run.detail.id, runName: run.detail.runName, status: run.detail.status, submittedAt: run.detail.submittedAt })),
      workDirs, workBytes, reclaimableBytes: reclaimable, resultBytes,
      active: group.runs.some((run) => run.detail.status === "running" || run.detail.status === "submitted"),
      cleanedAt: group.runs.find((run) => run.detail.workCleanedAt)?.detail.workCleanedAt,
      remote,
    });
  }
  sessions.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes);
  const caches: CacheUsage[] = [];
  for (const [id, label, path] of [
    ["work", "共享 work 目录", workDirectory()],
    ["executions", "运行记录与结果", join(dataDirectory(), "executions")],
    ["conda", "conda 环境缓存", condaCacheDirectory()],
    ["singularity", "Singularity / Apptainer 镜像", singularityCacheDirectory()],
  ] as const) {
    caches.push({ id, label, path, bytes: (await directorySize(path, budget)).bytes });
  }
  return { sessions, caches, truncated: budget.files <= 0 };
}

/** Remove one session's task directories and cache index; optionally its runs' published results too. */
export async function cleanSession(key: string, options: { results?: boolean } = {}, db: StudioStore = store()): Promise<CleanupResult> {
  const runs = db.runs(true);
  const plan = planCleanup(key, runs, (id) => db.tasks(id));
  if (plan.blockedBy) throw new HttpError(409, plan.blockedBy);
  let freed = 0;
  for (const dir of plan.directories) {
    freed += (await directorySize(dir)).reclaimable;
    await rm(dir, { recursive: true, force: true });
  }
  for (const dir of plan.cacheDirectories) await rm(dir, { recursive: true, force: true });
  const now = new Date().toISOString();
  for (const id of plan.affectedRuns) {
    const run = db.run(id, true);
    if (options.results && run) {
      const results = join(run.attemptDir, "results");
      freed += (await directorySize(results)).bytes;
      await rm(results, { recursive: true, force: true });
    }
    db.updateRun(id, (record) => {
      record.detail.workCleanedAt = now;
      if (options.results) record.detail.resultsRemovedAt = now;
    });
  }
  return { key, removedDirs: plan.directories.length, freedBytes: freed, affectedRuns: plan.affectedRuns, removedResults: Boolean(options.results) };
}
