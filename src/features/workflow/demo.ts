import { REFERENCE_ID, SAMPLESHEET_ID } from "./builtins";
import { EXAMPLE_CLUSTER_ID, EXAMPLE_FASTQ_QC_ID, EXAMPLE_REPORT_ID, EXAMPLE_SCANPY_QC_ID, EXAMPLE_TRIM_ID } from "./example-modules";
import { inHandle, outHandle } from "./ports";
import type { WorkflowDoc, WorkflowEdge, WorkflowNode } from "./types";

const node = (
  id: string,
  moduleId: string,
  alias: string,
  x: number,
  y: number,
  extra: Partial<WorkflowNode["data"]> = {},
): WorkflowNode => ({
  id,
  position: { x, y },
  data: { moduleId, alias, widgets: {}, config: { publish: true }, ...extra },
});

const edge = (source: string, out: string, target: string, inp: string): WorkflowEdge => ({
  id: `e_${source}_${out}_${target}_${inp}`,
  source,
  sourceHandle: outHandle(out),
  target,
  targetHandle: inHandle(inp),
});

/** A small single-cell pipeline on the example modules. Seeds the mock backend and stories. */
export function demoWorkflow(id: string): WorkflowDoc {
  return {
    id,
    name: "单细胞质控与聚类",
    description: "scanpy 过滤细胞 → Leiden 聚类 → 汇总报告",
    version: 1,
    params: { counts: "data/pbmc3k.h5ad", outdir: "results" },
    nodes: [
      node("counts", REFERENCE_ID, "COUNTS", 0, 160, { config: {}, settings: { param: "counts", format: "other" } }),
      node("qc", EXAMPLE_SCANPY_QC_ID, "SCANPY_QC", 360, 120, { widgets: { min_genes: 200, max_pct_mt: 5 } }),
      node("cluster", EXAMPLE_CLUSTER_ID, "SCANPY_CLUSTER", 760, 120, { widgets: { resolution: 0.5 } }),
      node("report", EXAMPLE_REPORT_ID, "SUMMARY_REPORT", 1160, 160, { widgets: { title: "PBMC 3k" } }),
    ],
    edges: [
      edge("counts", "with_meta", "qc", "adata"),
      edge("qc", "adata", "cluster", "adata"),
      edge("qc", "plots", "report", "files"),
      edge("cluster", "umap", "report", "files"),
      edge("cluster", "markers", "report", "files"),
    ],
    updatedAt: "2026-10-30T00:00:00.000Z",
  };
}

/** A per-sample read pipeline on the example modules, for simulator and output tests. */
export function readsQcWorkflow(id: string): WorkflowDoc {
  return {
    id,
    name: "测序质控",
    description: "修剪 → 质控 → 汇总报告",
    version: 1,
    params: { input: "assets/samplesheet.csv", outdir: "results" },
    nodes: [
      node("input", SAMPLESHEET_ID, "SAMPLESHEET", 0, 140, { config: {} }),
      node("trim", EXAMPLE_TRIM_ID, "TRIM_READS", 360, 100, { widgets: { min_length: 30 } }),
      node("qc", EXAMPLE_FASTQ_QC_ID, "FASTQ_QC", 760, 0),
      node("report", EXAMPLE_REPORT_ID, "SUMMARY_REPORT", 1160, 120, { widgets: { title: "Reads" } }),
    ],
    edges: [
      edge("input", "reads", "trim", "reads"),
      edge("trim", "reads", "qc", "reads"),
      edge("qc", "html", "report", "files"),
      edge("trim", "json", "report", "files"),
    ],
    updatedAt: "2026-10-30T00:00:00.000Z",
  };
}
