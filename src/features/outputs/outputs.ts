import type { ResultFile, RunSummary } from "@/features/runs/types";

/** How many finished runs the 产物 page reads results for. Older runs stay reachable from 运行记录. */
export const OUTPUT_RUN_LIMIT = 12;

export interface OutputRow {
  runId: string;
  runName: string;
  workflowName: string;
  completedAt?: string;
  path: string;
  name: string;
  /** First folder of the result path: the module alias that published it. */
  source: string;
  size: number;
  preview: ResultFile["preview"];
}

/** Succeeded runs, newest first, capped at `OUTPUT_RUN_LIMIT`. */
export function outputRuns(runs: readonly RunSummary[]): RunSummary[] {
  return runs
    .filter((run) => run.status === "succeeded")
    .sort((a, b) => (b.completedAt ?? b.submittedAt).localeCompare(a.completedAt ?? a.submittedAt))
    .slice(0, OUTPUT_RUN_LIMIT);
}

/** One row per result file with the run and module it came from. Nextflow's own reports are left out. */
export function outputRows(run: RunSummary, files: readonly ResultFile[]): OutputRow[] {
  return files
    .filter((file) => !file.path.startsWith("pipeline_info/"))
    .map((file) => {
      const parts = file.path.split("/");
      return {
        runId: run.id,
        runName: run.runName,
        workflowName: run.workflowName,
        completedAt: run.completedAt,
        path: file.path,
        name: parts.at(-1) ?? file.path,
        source: parts.length > 1 ? parts[0] : "",
        size: file.size,
        preview: file.preview,
      };
    });
}

export function filterOutputs(rows: readonly OutputRow[], query: string): OutputRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => [row.path, row.workflowName, row.runName, row.source].some((value) => value.toLowerCase().includes(needle)));
}
