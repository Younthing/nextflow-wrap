import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { defaultLaunchConfig } from "@/features/project/launch";
import { indexModules } from "@/features/workflow/catalog";
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { ModuleCatalog } from "@/features/workflow/types";
import { consoleLog, fileNameFor, resultContent, resultFiles } from "./outputs";
import { firstPreviewable } from "./preview";
import { simulateRun } from "./simulate";

const index = indexModules((catalog as ModuleCatalog).modules);
const T0 = Date.parse("2026-01-01T00:00:00Z");

function finishedRun() {
  const workflow = demoRnaseqWorkflow("wf");
  const base = {
    id: "run_out",
    runName: "brave_turing",
    workflow,
    params: workflow.params,
    submittedAt: new Date(T0).toISOString(),
    launch: defaultLaunchConfig(),
  };
  const now = T0 + 3_600_000;
  const sim = simulateRun(base, index, now);
  const iso = (ms?: number) => (ms === undefined ? undefined : new Date(ms).toISOString());
  return {
    run: { ...base, status: sim.status, startedAt: iso(sim.startedAt), completedAt: iso(sim.completedAt), errorMessage: sim.errorMessage },
    tasks: sim.tasks,
    now,
  };
}

describe("fileNameFor", () => {
  it("turns output globs into file names", () => {
    expect(fileNameFor("*_{fastqc.html}", "S1")).toBe("S1_fastqc.html");
    expect(fileNameFor("*.{bam}", "S1")).toBe("S1.bam");
    expect(fileNameFor("*fastp.fastq.gz", "S1")).toBe("S1.fastp.fastq.gz");
    expect(fileNameFor("star", "x")).toBe("star/");
  });
});

describe("run outputs", () => {
  it("publishes per-module files and the MultiQC report once the run is done", () => {
    const { run, tasks } = finishedRun();
    expect(run.status).toBe("succeeded");
    const paths = resultFiles(run, tasks, index).map((f) => f.path);
    expect(paths).toContain("multiqc/multiqc_report.html");
    expect(paths).toContain("fastqc/CONTROL_REP1_fastqc.html");
    expect(paths.some((p) => p.startsWith("pipeline_info/execution_trace_"))).toBe(true);
    const report = resultContent(run, tasks, index, "multiqc/multiqc_report.html");
    expect(report?.contentType).toMatch(/html/);
    expect(report?.body).toContain("TREATED_REP2");
    const files = resultFiles(run, tasks, index);
    const opened = firstPreviewable(files);
    const openedAt = files.findIndex((file) => file.path === opened?.path);
    expect(opened?.preview).toBeTruthy();
    expect(files.slice(0, openedAt).every((file) => !file.preview)).toBe(true);
  });

  it("logs submissions and the completion summary", () => {
    const { run, tasks, now } = finishedRun();
    const log = consoleLog(run, tasks, now).join("\n");
    expect(log).toMatch(/Submitted process > RNASEQ:FASTP \(CONTROL_REP1\)/);
    expect(log).toContain("Pipeline completed successfully");
  });
});
