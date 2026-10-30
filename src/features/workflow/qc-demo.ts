import { inHandle, outHandle } from "./ports";
import type { WorkflowDoc } from "./types";

/** A small workflow for real execution, without reference genome downloads. */
export function qcDemoWorkflow(input = "assets/samplesheet.csv"): WorkflowDoc {
  return {
    id: "qc-smoke",
    name: "FastQC and MultiQC",
    description: "Single-end and paired-end reads → FastQC → MultiQC",
    version: 1,
    project: { name: "studio/qcsmoke", version: "1.0.0", author: "Nextflow Studio" },
    params: { input, outdir: "results" },
    nodes: [
      { id: "input", position: { x: 0, y: 0 }, data: { moduleId: "builtin/samplesheet", alias: "SAMPLESHEET", widgets: {}, config: {} } },
      { id: "fastqc", position: { x: 320, y: 0 }, data: { moduleId: "nf-core/fastqc", alias: "FASTQC", widgets: {}, config: { publish: true } } },
      { id: "multiqc", position: { x: 640, y: 0 }, data: { moduleId: "nf-core/multiqc", alias: "MULTIQC", widgets: {}, config: { publish: true } } },
    ],
    edges: [
      { id: "reads", source: "input", sourceHandle: outHandle("reads"), target: "fastqc", targetHandle: inHandle("reads") },
      { id: "reports", source: "fastqc", sourceHandle: outHandle("zip"), target: "multiqc", targetHandle: inHandle("multiqc_files") },
    ],
    updatedAt: "2026-10-31T00:00:00.000Z",
  };
}
