import { describe, expect, it } from "vitest";

import type { ResultFile, RunSummary } from "@/features/runs/types";
import { filterOutputs, OUTPUT_RUN_LIMIT, outputRows, outputRuns } from "./outputs";

const progress = { total: 1, pending: 0, running: 0, completed: 1, cached: 0, failed: 0, aborted: 0 };
const run = (id: string, status: RunSummary["status"], completedAt?: string): RunSummary => ({
  id, runName: `name_${id}`, workflowId: "wf", workflowName: "单细胞质控", status, executor: "local", profile: "conda",
  submittedAt: "2026-01-01T00:00:00.000Z", completedAt, progress,
});
const file = (path: string, size = 10): ResultFile => ({ path, size, preview: "csv" });

describe("outputs", () => {
  it("read succeeded runs only, newest first, up to the limit", () => {
    const runs = [run("a", "succeeded", "2026-01-02"), run("b", "failed", "2026-01-05"), run("c", "succeeded", "2026-01-04"), run("d", "running")];
    expect(outputRuns(runs).map((item) => item.id)).toEqual(["c", "a"]);
    const many = Array.from({ length: OUTPUT_RUN_LIMIT + 3 }, (_, index) => run(`r${index}`, "succeeded", `2026-02-${String(index + 1).padStart(2, "0")}`));
    expect(outputRuns(many)).toHaveLength(OUTPUT_RUN_LIMIT);
  });

  it("name the module folder each file came from and skip Nextflow reports", () => {
    const rows = outputRows(run("a", "succeeded"), [file("qc/pbmc_qc.h5ad", 42), file("pipeline_info/report.html"), file("summary.csv")]);
    expect(rows.map((row) => [row.name, row.source, row.size])).toEqual([["pbmc_qc.h5ad", "qc", 42], ["summary.csv", "", 10]]);
    expect(rows[0]).toMatchObject({ runId: "a", runName: "name_a", workflowName: "单细胞质控" });
  });

  it("filter by file, module, run or workflow", () => {
    const rows = outputRows(run("a", "succeeded"), [file("qc/pbmc_qc.h5ad"), file("dock/poses.sdf")]);
    expect(filterOutputs(rows, "DOCK").map((row) => row.name)).toEqual(["poses.sdf"]);
    expect(filterOutputs(rows, "单细胞")).toHaveLength(2);
    expect(filterOutputs(rows, "name_a")).toHaveLength(2);
  });
});
