import { describe, expect, it } from "vitest";

import { defaultLaunchConfig } from "@/features/project/launch";
import { indexModules } from "@/features/workflow/catalog";
import { readsQcWorkflow } from "@/features/workflow/demo";
import { EXAMPLE_MODULES } from "@/features/workflow/example-modules";
import type { PipelineParams } from "@/features/workflow/types";
import { simulateRun } from "./simulate";

const index = indexModules(EXAMPLE_MODULES);
const T0 = Date.parse("2026-01-01T00:00:00Z");
const HOUR = 3_600_000;

function run(extra: { params?: PipelineParams; cancelledAt?: number } = {}) {
  const workflow = readsQcWorkflow("wf");
  return {
    id: "run_test",
    workflow,
    params: { ...workflow.params, ...extra.params },
    submittedAt: new Date(T0).toISOString(),
    cancelledAt: extra.cancelledAt ? new Date(extra.cancelledAt).toISOString() : undefined,
    launch: defaultLaunchConfig(),
  };
}

describe("simulateRun", () => {
  it("is queued before start and succeeds once every task finishes", () => {
    expect(simulateRun(run(), index, T0 + 1000).status).toBe("submitted");
    const done = simulateRun(run(), index, T0 + HOUR);
    expect(done.status).toBe("succeeded");
    expect(done.progress.completed).toBe(done.progress.total);
    // TRIM_READS and FASTQ_QC run once per sample; the collecting report runs once.
    expect(done.tasks.filter((t) => t.process === "TRIM_READS")).toHaveLength(3);
    expect(done.tasks.filter((t) => t.process === "SUMMARY_REPORT")).toHaveLength(1);
  });

  it("never starts a task before its inputs are done", () => {
    const { tasks } = simulateRun(run(), index, T0 + HOUR);
    const report = tasks.find((t) => t.process === "SUMMARY_REPORT")!;
    const lastOther = Math.max(...tasks.filter((t) => t !== report).map((t) => Date.parse(t.completedAt!)));
    expect(Date.parse(report.startedAt!)).toBeGreaterThan(lastOther);
  });

  it("fails with the failing task's name when simulate_failure is set", () => {
    const sim = simulateRun(run({ params: { simulate_failure: true } }), index, T0 + HOUR);
    expect(sim.status).toBe("failed");
    expect(sim.progress.failed).toBe(1);
    expect(sim.errorMessage).toMatch(/terminated with an error exit status/);
    expect(sim.failedNodeId).toBeDefined();
  });

  it("aborts running tasks when cancelled", () => {
    const sim = simulateRun(run({ cancelledAt: T0 + 6000 }), index, T0 + HOUR);
    expect(sim.status).toBe("cancelled");
    expect(sim.progress.aborted).toBeGreaterThan(0);
    expect(sim.tasks.some((t) => t.process === "SUMMARY_REPORT" && t.status === "pending")).toBe(true);
  });
});

describe("simulateRun terminal states", () => {
  it("always reports completedAt together with a terminal status", () => {
    for (let t = 0; t < 120_000; t += 250) {
      const sim = simulateRun(run({ cancelledAt: T0 + 9000 }), index, T0 + t);
      if (sim.status === "cancelled") expect(sim.completedAt).toBeLessThanOrEqual(T0 + t);
      const ok = simulateRun(run(), index, T0 + t);
      if (ok.status === "succeeded") expect(ok.completedAt).toBeLessThanOrEqual(T0 + t);
    }
  });
});
