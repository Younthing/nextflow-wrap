import type { LaunchConfig } from "@/features/project/launch";
import type { RemoteRunState } from "@/features/remote/types";
import type { PipelineParams, WorkflowDoc } from "@/features/workflow/types";
import type { ResultPreview } from "./preview";

export type RunStatus = "submitted" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type TaskStatus = "pending" | "submitted" | "running" | "completed" | "cached" | "failed" | "aborted";

export interface ResultFile {
  path: string;
  size: number;
  preview: ResultPreview;
  nodeId?: string;
}

export interface RunProgress {
  total: number;
  pending: number;
  running: number;
  completed: number;
  cached: number;
  failed: number;
  aborted: number;
}

export interface RunSummary {
  phase?: "queued" | "preparing" | "executing" | "finalizing" | "cancelling";
  /** Finished with a Nextflow session whose cache is still on disk: the canvas can run with `-resume` of it. */
  resumable?: boolean;
  id: string;
  /** Nextflow run name, e.g. `tender_curie`. */
  runName: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  executor: LaunchConfig["executor"];
  profile: string;
  submittedAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: RunProgress;
  errorMessage?: string;
  /** Name of the cluster the run went to over SSH; absent for runs started from this machine. */
  remoteHost?: string;
}

export interface ProjectSnapshot {
  name: string;
  files: { path: string; content: string; executable?: boolean }[];
}

/** POST /api/runs */
export interface LaunchRequest {
  /** Run the canvas with `-resume` of this earlier run's session. */
  resumeFrom?: string;
  workflow: WorkflowDoc;
  project: ProjectSnapshot;
  params: PipelineParams;
  launch: LaunchConfig;
  runConfig: string;
  command: string;
}

export interface RunDetail extends RunSummary {
  /** Exact engine version resolved for this execution. */
  nextflowVersion?: string;
  nextflowSessionId?: string;
  resumeFromRunId?: string;
  exitCode?: number;
  command: string;
  launch: LaunchConfig;
  params: PipelineParams;
  runConfig: string;
  project: ProjectSnapshot;
  workflow: WorkflowDoc;
  cancelledAt?: string;
  /** The session's task directories were removed on the disk page; `-resume` can no longer use them. */
  workCleanedAt?: string;
  /** Published results were removed too. */
  resultsRemovedAt?: string;
  /** Where the run lives on its cluster, once the runner has started it there. */
  remote?: RemoteRunState;
}

export interface TaskRecord {
  id?: string;
  taskId?: string;
  attempt?: number;
  /** Nextflow task hash, e.g. `3f/a1b2c3`. */
  hash: string;
  nodeId: string;
  process: string;
  /** `FASTQC (SAMPLE_1)` */
  name: string;
  tag?: string;
  status: TaskStatus;
  submittedAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  cpus: number;
  /** Peak memory in bytes. */
  peakRss?: number;
  /** CPU usage percentage, like the trace's %cpu. */
  cpuPercent?: number;
  exitStatus?: number;
  workdir: string;
}
