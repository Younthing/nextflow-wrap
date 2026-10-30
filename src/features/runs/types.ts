import type { LaunchConfig } from "@/features/project/launch";
import type { PipelineParams, WorkflowDoc } from "@/features/workflow/types";

export type RunStatus = "submitted" | "running" | "succeeded" | "failed" | "cancelled";
export type TaskStatus = "pending" | "submitted" | "running" | "completed" | "cached" | "failed" | "aborted";

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
}

export interface ProjectSnapshot {
  name: string;
  files: { path: string; content: string }[];
  components: { kind: "module" | "subworkflow"; path: string; gitSha: string }[];
}

/** POST /api/runs */
export interface LaunchRequest {
  workflow: WorkflowDoc;
  project: ProjectSnapshot;
  params: PipelineParams;
  launch: LaunchConfig;
  runConfig: string;
  command: string;
}

export interface RunDetail extends RunSummary {
  command: string;
  launch: LaunchConfig;
  params: PipelineParams;
  runConfig: string;
  project: ProjectSnapshot;
  workflow: WorkflowDoc;
  cancelledAt?: string;
}

export interface TaskRecord {
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
