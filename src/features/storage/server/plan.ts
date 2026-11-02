import { isAbsolute, relative, resolve } from "node:path";
import type { StoredExecution } from "@/lib/server/database";
import type { TaskRecord } from "@/features/runs/types";

/**
 * `workDir` is shared by every workflow, so disk is cleaned per Nextflow session, never by deleting a run's
 * folder. A resumed run keeps the session id and reuses the cached task directories of earlier runs in it, so
 * removing a session's work makes every run in that session unable to resume, and nothing else.
 */
export const sessionKey = (run: StoredExecution) => run.sessionId ?? run.detail.nextflowSessionId ?? run.detail.id;

export interface SessionGroup { key: string; runs: StoredExecution[] }

export function groupSessions(runs: StoredExecution[]): SessionGroup[] {
  const groups = new Map<string, StoredExecution[]>();
  for (const run of runs) {
    const key = sessionKey(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups].map(([key, members]) => ({ key, runs: members.sort((a, b) => a.detail.submittedAt.localeCompare(b.detail.submittedAt)) }));
}

/** Work root a run used: an absolute local path, or undefined for object storage. */
export function localWorkRoot(run: StoredExecution): string | undefined {
  const workDir = run.detail.launch.workDir;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(workDir)) return undefined;
  return isAbsolute(workDir) ? workDir : resolve(run.projectDir, "../work");
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** A task directory is `<work>/xx/yyyy…`; anything else recorded in a trace is not removed. */
export function taskDirectory(root: string, workdir: string): string | undefined {
  if (!workdir) return undefined;
  const path = isAbsolute(workdir) ? resolve(workdir) : resolve(root, workdir);
  if (!inside(root, path)) return undefined;
  return /^[0-9a-f]{2}\/[0-9a-f]{6,}$/i.test(relative(root, path).split("\\").join("/")) ? path : undefined;
}

export interface CleanupPlan {
  key: string;
  /** Task directories to remove: the session's, minus any another session also recorded. */
  directories: string[];
  /** `.nextflow/cache/<session>` in each launch directory. */
  cacheDirectories: string[];
  affectedRuns: string[];
  remote: boolean;
  blockedBy?: string;
}

export function planCleanup(key: string, runs: StoredExecution[], tasks: (runId: string) => TaskRecord[]): CleanupPlan {
  const groups = groupSessions(runs);
  const target = groups.find((group) => group.key === key);
  if (!target) return { key, directories: [], cacheDirectories: [], affectedRuns: [], remote: false, blockedBy: "没有这个会话" };
  const active = target.runs.find((run) => run.detail.status === "running" || run.detail.status === "submitted");
  const dirsOf = (members: StoredExecution[]) => {
    const out = new Set<string>();
    let remote = false;
    for (const run of members) {
      const root = localWorkRoot(run);
      if (!root) { remote = true; continue; }
      for (const task of tasks(run.detail.id)) {
        const dir = taskDirectory(root, task.workdir);
        if (dir) out.add(dir);
      }
    }
    return { dirs: out, remote };
  };
  const mine = dirsOf(target.runs);
  const others = dirsOf(groups.filter((group) => group.key !== key).flatMap((group) => group.runs));
  const sessionId = target.runs.find((run) => run.sessionId)?.sessionId;
  return {
    key,
    directories: [...mine.dirs].filter((dir) => !others.dirs.has(dir)).sort(),
    cacheDirectories: sessionId ? [...new Set(target.runs.map((run) => resolve(run.projectDir, ".nextflow", "cache", sessionId)))] : [],
    affectedRuns: target.runs.map((run) => run.detail.id),
    remote: mine.remote,
    blockedBy: active ? `运行 ${active.detail.runName} 还没有结束` : undefined,
  };
}
