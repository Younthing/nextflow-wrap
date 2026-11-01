import type { ChannelElement, ModuleDef, PortDef } from "./types";

/**
 * Published local modules used by tests, stories and the mock backend.
 * They have the shape a notebook publish produces, with single-cell and
 * docking steps as the examples. They carry no generated script, so they
 * are never written into a real project.
 */

const meta = (): ChannelElement => ({ name: "meta", type: "map", kind: "meta", description: "样本信息，如 [ id:'S1' ]" });
const file = (name: string, format: string, description = name, pattern = `*.${format}`): ChannelElement => ({
  name,
  type: "file",
  kind: "file",
  description,
  pattern,
  format,
});
const port = (name: string, elements: ChannelElement[], description = name, extra: Partial<PortDef> = {}): PortDef => ({
  name,
  description,
  elements,
  ...extra,
});
const widget = (name: string, kind: "integer" | "number" | "string", description = name): PortDef => ({
  name,
  description,
  widget: kind,
  elements: [{ name, type: kind, kind: "value", description }],
});

function example(spec: Pick<ModuleDef, "process" | "name" | "description" | "category" | "keywords" | "inputs" | "outputs"> & { label?: string }): ModuleDef {
  const path = spec.process.toLowerCase();
  return {
    id: `script/${path}/v1`,
    path,
    tools: [],
    origin: "script",
    tryRun: "passed",
    version: "v1",
    kernel: "python3",
    command: `bin/${path}.py`,
    ...spec,
  };
}

export const EXAMPLE_TRIM_ID = "script/trim_reads/v1";
export const EXAMPLE_FASTQ_QC_ID = "script/fastq_qc/v1";
export const EXAMPLE_SCANPY_QC_ID = "script/scanpy_qc/v1";
export const EXAMPLE_CLUSTER_ID = "script/scanpy_cluster/v1";
export const EXAMPLE_REPORT_ID = "script/summary_report/v1";
export const EXAMPLE_RECEPTOR_ID = "script/prepare_receptor/v1";
export const EXAMPLE_DOCK_ID = "script/vina_dock/v1";

export const EXAMPLE_MODULES: ModuleDef[] = [
  example({
    process: "TRIM_READS",
    name: "trim_reads",
    category: "测序预处理",
    description: "切除接头和低质量碱基。",
    keywords: ["fastq", "trim", "adapter"],
    label: "process_low",
    inputs: [
      port("reads", [meta(), file("reads", "fastq", "FastQ 文件", "*.fastq.gz"), file("adapters", "fasta", "接头序列，可选 (optional)")], "每个样本的 FastQ"),
      widget("min_length", "integer", "保留的最短读长"),
    ],
    outputs: [
      port("reads", [meta(), file("reads", "fastq", "修剪后的 FastQ", "*.trim.fastq.gz")]),
      port("json", [meta(), file("json", "json", "修剪统计")]),
    ],
  }),
  example({
    process: "FASTQ_QC",
    name: "fastq_qc",
    category: "测序预处理",
    description: "统计读长和碱基质量，生成 HTML 报告。",
    keywords: ["fastq", "quality", "qc"],
    inputs: [port("reads", [meta(), file("reads", "fastq", "FastQ 文件", "*.fastq.gz")], "每个样本的 FastQ")],
    outputs: [
      port("html", [meta(), file("html", "html", "质控报告")]),
      port("stats", [meta(), file("stats", "json", "质控统计")]),
    ],
  }),
  example({
    process: "SCANPY_QC",
    name: "scanpy_qc",
    category: "单细胞",
    description: "按基因数和线粒体比例过滤细胞，输出过滤后的 AnnData。",
    keywords: ["single-cell", "scanpy", "h5ad", "filter"],
    label: "process_medium",
    inputs: [
      port("adata", [meta(), file("adata", "h5ad", "原始计数矩阵")], "每个样本的 AnnData"),
      widget("min_genes", "integer", "每个细胞至少检出的基因数"),
      widget("max_pct_mt", "number", "线粒体基因比例上限"),
    ],
    outputs: [
      port("adata", [meta(), file("adata", "h5ad", "过滤后的 AnnData", "*.filtered.h5ad")]),
      port("plots", [meta(), file("plots", "png", "质控小提琴图")]),
    ],
  }),
  example({
    process: "SCANPY_CLUSTER",
    name: "scanpy_cluster",
    category: "单细胞",
    description: "标准化、降维、Leiden 聚类并计算 marker 基因。",
    keywords: ["single-cell", "scanpy", "leiden", "umap", "cluster"],
    label: "process_medium",
    inputs: [
      port("adata", [meta(), file("adata", "h5ad", "过滤后的 AnnData")], "每个样本的 AnnData"),
      widget("resolution", "number", "Leiden 分辨率"),
    ],
    outputs: [
      port("adata", [meta(), file("adata", "h5ad", "带聚类结果的 AnnData", "*.clustered.h5ad")]),
      port("umap", [meta(), file("umap", "png", "UMAP 图")]),
      port("markers", [meta(), file("markers", "csv", "各簇 marker 基因")]),
    ],
  }),
  example({
    process: "SUMMARY_REPORT",
    name: "summary_report",
    category: "报告",
    description: "把各步骤的图表和统计汇总成一份 HTML 报告。",
    keywords: ["report", "summary", "html"],
    inputs: [
      port("files", [meta(), { name: "files", type: "file", kind: "file", description: "任意结果文件", pattern: "*" }], "要汇总的文件", { collect: true }),
      widget("title", "string", "报告标题"),
    ],
    outputs: [port("report", [file("report", "html", "汇总报告", "summary_report.html")])],
  }),
  example({
    process: "PREPARE_RECEPTOR",
    name: "prepare_receptor",
    category: "分子对接",
    description: "给受体蛋白加氢并转换为 PDBQT。",
    keywords: ["docking", "receptor", "pdb", "pdbqt"],
    inputs: [port("receptor", [file("receptor", "pdb", "受体结构")], "受体 PDB 文件")],
    outputs: [port("pdbqt", [file("pdbqt", "pdbqt", "受体 PDBQT")])],
  }),
  example({
    process: "VINA_DOCK",
    name: "vina_dock",
    category: "分子对接",
    description: "用 AutoDock Vina 把每个配体对接到受体，输出构象和打分。",
    keywords: ["docking", "vina", "ligand", "sdf"],
    label: "process_high",
    inputs: [
      port("ligand", [meta(), file("ligand", "sdf", "配体结构")], "每个配体"),
      port("receptor", [file("receptor", "pdbqt", "受体 PDBQT")], "受体"),
      widget("exhaustiveness", "integer", "搜索强度"),
    ],
    outputs: [
      port("poses", [meta(), file("poses", "sdf", "对接构象", "*.poses.sdf")]),
      port("scores", [meta(), file("scores", "csv", "结合能打分")]),
    ],
  }),
];

/** Example modules keyed by id, for tests. */
export const exampleModule = (id: string): ModuleDef => {
  const def = EXAMPLE_MODULES.find((m) => m.id === id);
  if (!def) throw new Error(`Unknown example module ${id}`);
  return def;
};
