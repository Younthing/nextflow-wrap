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

/** A small RNA-seq pipeline used to seed the mock backend. */
export function demoRnaseqWorkflow(id: string): WorkflowDoc {
  return {
    id,
    name: "RNA-seq 比对与质控",
    description: "fastp 修剪 → STAR 比对 → MultiQC 汇总",
    version: 1,
    params: {
      input: "assets/samplesheet.csv",
      outdir: "results",
      fasta: "s3://ngi-igenomes/igenomes/Homo_sapiens/Ensembl/GRCh38/Sequence/WholeGenomeFasta/genome.fa",
      gtf: "s3://ngi-igenomes/igenomes/Homo_sapiens/Ensembl/GRCh38/Annotation/Genes/genes.gtf",
    },
    nodes: [
      node("input", "builtin/samplesheet", "SAMPLESHEET", 0, 140, { config: {} }),
      node("fasta", "builtin/reference", "REFERENCE", 0, 420, { config: {}, settings: { param: "fasta", format: "fasta" } }),
      node("gtf", "builtin/reference", "REFERENCE_2", 0, 620, { config: {}, settings: { param: "gtf", format: "gtf" } }),
      node("fastp", "nf-core/fastp", "FASTP", 360, 60, {
        widgets: { discard_trimmed_pass: false, save_trimmed_fail: false, save_merged: false },
      }),
      node("fastqc", "nf-core/fastqc", "FASTQC", 760, 0),
      node("star_index", "nf-core/star/genomegenerate", "STAR_GENOMEGENERATE", 360, 480),
      node("star", "nf-core/star/align", "STAR_ALIGN", 760, 320, {
        widgets: { star_ignore_sjdbgtf: false },
        config: { publish: true, args: "--outSAMtype BAM SortedByCoordinate --quantMode GeneCounts" },
      }),
      node("multiqc", "nf-core/multiqc", "MULTIQC", 1180, 120),
    ],
    edges: [
      edge("input", "reads", "fastp", "reads"),
      edge("fastp", "reads", "fastqc", "reads"),
      edge("fastp", "reads", "star", "reads"),
      edge("fasta", "with_meta", "star_index", "fasta"),
      edge("gtf", "with_meta", "star_index", "gtf"),
      edge("star_index", "index", "star", "index"),
      edge("gtf", "with_meta", "star", "gtf"),
      edge("fastqc", "zip", "multiqc", "multiqc_files"),
      edge("fastp", "json", "multiqc", "multiqc_files"),
      edge("star", "log_final", "multiqc", "multiqc_files"),
    ],
    updatedAt: "2026-10-30T00:00:00.000Z",
  };
}
