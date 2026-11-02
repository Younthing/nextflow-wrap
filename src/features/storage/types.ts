/** Disk usage grouped by Nextflow session: every run resumed from another shares its session id and its cache. */
export interface SessionRunRef { id: string; runName: string; status: string; submittedAt: string }

export interface SessionUsage {
  /** Nextflow session id, or the run id for a run that never reported one. */
  key: string;
  sessionId?: string;
  workflowId: string;
  workflowName: string;
  runs: SessionRunRef[];
  /** Local task directories recorded for the session's tasks. */
  workDirs: number;
  workBytes: number;
  /** Bytes freed by removing the work directories: files also hard-linked into results are kept by the link. */
  reclaimableBytes: number;
  resultBytes: number;
  /** A run is going: nothing can be removed. */
  active: boolean;
  /** Set once the work directories were removed: the session can no longer `-resume`. */
  cleanedAt?: string;
  /** Work directories outside this machine's filesystem (object storage); clean them with `nextflow clean`. */
  remote: boolean;
}

export interface CacheUsage { id: "conda" | "singularity" | "work" | "executions"; label: string; path: string; bytes: number }

export interface StorageReport { sessions: SessionUsage[]; caches: CacheUsage[]; truncated: boolean }

export interface CleanupResult {
  key: string;
  removedDirs: number;
  freedBytes: number;
  /** Runs that can no longer resume because their cached tasks are gone. */
  affectedRuns: string[];
  removedResults: boolean;
}
