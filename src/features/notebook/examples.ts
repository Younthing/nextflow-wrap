import type { ModuleDef, WorkflowDoc, WorkflowEdge, WorkflowNode } from "@/features/workflow/types";
import { FILE_ID } from "@/features/workflow/builtins";
import { inHandle, outHandle } from "@/features/workflow/ports";
import { EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { convertNotebook, inputPorts, outputPorts } from "./convert";
import { buildLibraryCopy, type ModuleLibraryCopy } from "./library-copy";
import { processName } from "./publish";
import type { NotebookCell, NotebookDoc } from "./types";

/**
 * The example project: four Python notebooks (pandas, matplotlib, scipy) that take an RNA-seq style count table
 * from quality control to a report, each exported as a module, and a workflow that chains them. Each step reads
 * tables and parameters and writes tables and figures, the way a real analysis module does.
 *
 * Cells read workspace paths (`data/counts.tsv`), so every notebook runs as is in the example project; run them in
 * order and each one finds the files the previous one wrote.
 */
const EXAMPLE_TIME = "2026-01-01T00:00:00.000Z";

const cells = (...list: [NotebookCell["role"], string][]): NotebookCell[] =>
  list.map(([role, source], index) => ({ id: `c${index + 1}`, role, source }));

const PLOT_SETUP = `import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
`;

const countQc = cells(
  ["markdown", "# 计数表质控\n\n按样本统计文库大小和检出基因数，过滤低表达基因。\n"],
  ["input", `# @input name=counts type=path required
# @input name=samples type=path required
# @input name=min_count type=int default=10
# @input name=min_samples type=int default=2
counts = "data/counts.tsv"
samples = "data/samples.csv"
min_count = 10
min_samples = 2
`],
  ["code", `${PLOT_SETUP}
table = pd.read_csv(counts, sep="\\t", index_col=0)
meta = pd.read_csv(samples).set_index("sample")
missing = sorted(set(meta.index) - set(table.columns))
if missing:
    raise SystemExit(f"计数表缺少样本：{', '.join(missing)}")
table = table[meta.index]
`],
  ["explore", `table.describe().T
`],
  ["output", `# @output name=filtered type=path pattern="filtered_counts.tsv"
# @output name=metrics type=path pattern="qc_metrics.tsv"
# @output name=plot type=path pattern="qc_library_size.png"
metrics = pd.DataFrame({
    "library_size": table.sum(),
    "detected_genes": (table > 0).sum(),
}).join(meta)
keep = (table >= min_count).sum(axis=1) >= min_samples
table[keep].to_csv("filtered_counts.tsv", sep="\\t")
metrics.to_csv("qc_metrics.tsv", sep="\\t", index_label="sample")

groups = {group: f"C{i}" for i, group in enumerate(metrics["condition"].unique())}
colors = metrics["condition"].map(groups)
fig, axes = plt.subplots(1, 2, figsize=(9, 3.5), constrained_layout=True)
axes[0].bar(metrics.index, metrics["library_size"] / 1e6, color=colors)
axes[0].set_ylabel("Library size (M reads)")
axes[1].bar(metrics.index, metrics["detected_genes"], color=colors)
axes[1].set_ylabel("Detected genes")
for axis in axes:
    axis.tick_params(axis="x", rotation=45)
fig.savefig("qc_library_size.png", dpi=150)
print(f"保留 {int(keep.sum())} / {len(keep)} 个基因")
`],
);

const normalizePca = cells(
  ["markdown", "# 标准化与 PCA\n\nlog-CPM 标准化，取高变基因做主成分分析。\n"],
  ["input", `# @input name=counts type=path required
# @input name=samples type=path required
# @input name=n_top type=int default=500
# @input name=pseudocount type=float default=1
counts = "filtered_counts.tsv"
samples = "data/samples.csv"
n_top = 500
pseudocount = 1.0
`],
  ["code", `${PLOT_SETUP}
table = pd.read_csv(counts, sep="\\t", index_col=0)
meta = pd.read_csv(samples).set_index("sample").loc[table.columns]
cpm = table / table.sum() * 1e6
logcpm = np.log2(cpm + pseudocount)
`],
  ["output", `# @output name=normalized type=path pattern="normalized.tsv"
# @output name=scores type=path pattern="pca_scores.tsv"
# @output name=plot type=path pattern="pca.png"
logcpm.round(4).to_csv("normalized.tsv", sep="\\t")

top = logcpm.loc[logcpm.var(axis=1).sort_values(ascending=False).index[:n_top]]
centered = top.sub(top.mean(axis=1), axis=0).T.to_numpy()
u, s, _ = np.linalg.svd(centered, full_matrices=False)
explained = s**2 / np.sum(s**2)
scores = pd.DataFrame(u[:, :2] * s[:2], index=top.columns, columns=["PC1", "PC2"]).join(meta)
scores.round(4).to_csv("pca_scores.tsv", sep="\\t", index_label="sample")

fig, axis = plt.subplots(figsize=(5, 4), constrained_layout=True)
for i, (group, rows) in enumerate(scores.groupby("condition")):
    axis.scatter(rows["PC1"], rows["PC2"], label=group, color=f"C{i}", s=60)
    for name, row in rows.iterrows():
        axis.annotate(name, (row["PC1"], row["PC2"]), textcoords="offset points", xytext=(4, 4), fontsize=8)
axis.set_xlabel(f"PC1 ({explained[0]:.0%})")
axis.set_ylabel(f"PC2 ({explained[1]:.0%})")
axis.legend(frameon=False)
fig.savefig("pca.png", dpi=150)
`],
);

const groupCompare = cells(
  ["markdown", "# 分组差异分析\n\n两组之间做 Welch t 检验，Benjamini-Hochberg 校正。\n"],
  ["input", `# @input name=normalized type=path required
# @input name=samples type=path required
# @input name=group_col type=str default="condition"
# @input name=reference type=str default="control"
# @input name=alpha type=float default=0.05
# @input name=top_n type=int default=20
normalized = "normalized.tsv"
samples = "data/samples.csv"
group_col = "condition"
reference = "control"
alpha = 0.05
top_n = 20
`],
  ["code", `${PLOT_SETUP}from scipy import stats

table = pd.read_csv(normalized, sep="\\t", index_col=0)
meta = pd.read_csv(samples).set_index("sample").loc[table.columns]
groups = sorted(meta[group_col].unique())
if reference not in groups or len(groups) != 2:
    raise SystemExit(f"{group_col} 需要恰好两组且包含 {reference}，实际：{groups}")
other = next(group for group in groups if group != reference)
ref = table.loc[:, meta[group_col] == reference]
test = table.loc[:, meta[group_col] == other]
`],
  ["output", `# @output name=results type=path pattern="group_compare.tsv"
# @output name=top type=path pattern="top_genes.tsv"
# @output name=volcano type=path pattern="volcano.png"
t, p = stats.ttest_ind(test, ref, axis=1, equal_var=False)
results = pd.DataFrame({
    "mean_" + reference: ref.mean(axis=1),
    "mean_" + other: test.mean(axis=1),
    "log2fc": test.mean(axis=1) - ref.mean(axis=1),
    "t": t,
    "pvalue": p,
}, index=table.index)
# Benjamini-Hochberg: p * n / rank, made monotone from the largest p down.
ranked = results["pvalue"].dropna().sort_values()
raw = ranked * len(ranked) / np.arange(1, len(ranked) + 1)
results["padj"] = raw[::-1].cummin()[::-1].clip(upper=1)
results = results.sort_values("padj")
results.round(6).to_csv("group_compare.tsv", sep="\\t", index_label="gene")
results[results["padj"] < alpha].head(top_n).round(6).to_csv("top_genes.tsv", sep="\\t", index_label="gene")

significant = results["padj"] < alpha
fig, axis = plt.subplots(figsize=(5, 4), constrained_layout=True)
axis.scatter(results["log2fc"], -np.log10(results["pvalue"]), s=8, color=np.where(significant, "C3", "0.6"))
axis.set_xlabel(f"log2 fold change ({other} vs {reference})")
axis.set_ylabel("-log10 p")
fig.savefig("volcano.png", dpi=150)
print(f"padj < {alpha}：{int(significant.sum())} 个基因")
`],
);

const summaryReport = cells(
  ["markdown", "# 汇总报告\n\n把质控、PCA 和差异分析的表与图合成一个 HTML 报告。\n"],
  ["input", `# @input name=metrics type=path required
# @input name=scores type=path required
# @input name=results type=path required
# @input name=qc_plot type=path required
# @input name=pca_plot type=path required
# @input name=volcano type=path required
# @input name=title type=str default="表达分析报告"
# @input name=alpha type=float default=0.05
metrics = "qc_metrics.tsv"
scores = "pca_scores.tsv"
results = "group_compare.tsv"
qc_plot = "qc_library_size.png"
pca_plot = "pca.png"
volcano = "volcano.png"
title = "表达分析报告"
alpha = 0.05
`],
  ["code", `import base64
import html
import pandas as pd

qc = pd.read_csv(metrics, sep="\\t", index_col=0)
pcs = pd.read_csv(scores, sep="\\t", index_col=0)
de = pd.read_csv(results, sep="\\t", index_col=0)

def image(path):
    with open(path, "rb") as handle:
        return f'<img src="data:image/png;base64,{base64.b64encode(handle.read()).decode()}" style="max-width:100%">'
`],
  ["output", `# @output name=report type=path pattern="report.html"
significant = de[de["padj"] < alpha]
sections = [
    ("样本质控", qc.to_html(float_format="%.0f"), image(qc_plot)),
    ("主成分分析", pcs.to_html(float_format="%.2f"), image(pca_plot)),
    (f"差异基因（padj < {alpha}，{len(significant)} 个）", significant.head(30).to_html(float_format="%.3g"), image(volcano)),
]
body = "".join(f"<h2>{html.escape(name)}</h2>{figure}{table}" for name, table, figure in sections)
page = f"""<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem}}table{{border-collapse:collapse;font-size:13px;margin:1rem 0}}td,th{{border:1px solid #ddd;padding:4px 8px;text-align:right}}</style>
<h1>{html.escape(title)}</h1>{body}"""
with open("report.html", "w", encoding="utf-8") as handle:
    handle.write(page)
`],
);

interface ExampleStep {
  /** Notebook id; the module is `script/<id>`. */
  id: string;
  name: string;
  description: string;
  cells: NotebookCell[];
}

const STEPS: ExampleStep[] = [
  { id: "count_qc", name: "count_qc", description: "计数表质控：文库大小、检出基因数，过滤低表达基因", cells: countQc },
  { id: "normalize_pca", name: "normalize_pca", description: "log-CPM 标准化，高变基因 PCA", cells: normalizePca },
  { id: "group_compare", name: "group_compare", description: "两组 Welch t 检验与 BH 校正，火山图", cells: groupCompare },
  { id: "summary_report", name: "summary_report", description: "质控、PCA、差异结果汇总为 HTML 报告", cells: summaryReport },
];

export const EXAMPLE_MODULE_IDS = STEPS.map((step) => `script/${step.id}`);

/** The example project's notebooks. */
export function exampleNotebooks(projectId = EXAMPLE_PROJECT_ID): NotebookDoc[] {
  return STEPS.map((step) => ({
    id: step.id,
    name: step.name,
    description: step.description,
    kernel: "python3",
    language: "python",
    cells: step.cells,
    rev: 1,
    createdAt: EXAMPLE_TIME,
    updatedAt: EXAMPLE_TIME,
    projectId,
  }));
}

/** Each example notebook exported as a module, as the export wizard would after a passing try-run. */
export function exampleModules(notebooks = exampleNotebooks()): ModuleDef[] {
  return notebooks.map((notebook) => {
    const entry = `bin/${notebook.id}_v1.py`;
    const converted = convertNotebook(notebook, entry);
    return {
      id: `script/${notebook.id}`,
      path: `${notebook.id}_v1`,
      name: notebook.name,
      process: processName(notebook.name),
      category: "自定义",
      description: notebook.description,
      keywords: ["notebook", "pandas", notebook.id],
      tools: [],
      origin: "script",
      inputs: inputPorts(converted.inputs),
      outputs: outputPorts(converted.outputs),
      version: "v1",
      tryRun: "passed",
      command: entry,
      script: converted.script,
      kernel: notebook.kernel,
      label: "process_low",
    } satisfies ModuleDef;
  });
}

/** The notebook copy saved with each example module, so "在笔记本中编辑" opens it. */
export function exampleLibraryCopies(notebooks = exampleNotebooks(), modules = exampleModules(notebooks)): ModuleLibraryCopy[] {
  return modules.map((def, index) => buildLibraryCopy({ notebook: notebooks[index]!, module: def, savedAt: EXAMPLE_TIME }));
}

const node = (id: string, moduleId: string, alias: string, x: number, y: number, extra: Partial<WorkflowNode["data"]> = {}): WorkflowNode => ({
  id,
  position: { x, y },
  data: { moduleId, alias, widgets: {}, config: { publish: true }, ...extra },
});

const edge = (source: string, out: string, target: string, input: string): WorkflowEdge => ({
  id: `e_${source}_${out}_${target}_${input}`,
  source,
  sourceHandle: outHandle(out),
  target,
  targetHandle: inHandle(input),
});

/** The four example modules chained on the example data. Paths are workspace paths. */
export function exampleWorkflow(projectId = EXAMPLE_PROJECT_ID): WorkflowDoc {
  return {
    id: "example_expression",
    name: "表达分析示例",
    description: "质控 → 标准化与 PCA → 分组差异 → 报告",
    version: 1,
    params: { outdir: "results" },
    projectId,
    nodes: [
      node("counts", FILE_ID, "COUNTS", 0, 80, { config: {}, settings: { path: "data/counts.tsv" } }),
      node("samples", FILE_ID, "SAMPLES", 0, 320, { config: {}, settings: { path: "data/samples.csv" } }),
      node("qc", "script/count_qc", "COUNT_QC", 380, 80, { widgets: { min_count: 10, min_samples: 2 } }),
      node("pca", "script/normalize_pca", "NORMALIZE_PCA", 780, 80, { widgets: { n_top: 500, pseudocount: 1 } }),
      node("de", "script/group_compare", "GROUP_COMPARE", 1180, 80, { widgets: { group_col: "condition", reference: "control", alpha: 0.05, top_n: 20 } }),
      node("report", "script/summary_report", "SUMMARY_REPORT", 1580, 200, { widgets: { title: "表达分析报告", alpha: 0.05 } }),
    ],
    edges: [
      edge("counts", "file", "qc", "counts"),
      edge("samples", "file", "qc", "samples"),
      edge("qc", "filtered", "pca", "counts"),
      edge("samples", "file", "pca", "samples"),
      edge("pca", "normalized", "de", "normalized"),
      edge("samples", "file", "de", "samples"),
      edge("qc", "metrics", "report", "metrics"),
      edge("qc", "plot", "report", "qc_plot"),
      edge("pca", "scores", "report", "scores"),
      edge("pca", "plot", "report", "pca_plot"),
      edge("de", "results", "report", "results"),
      edge("de", "volcano", "report", "volcano"),
    ],
    updatedAt: EXAMPLE_TIME,
  };
}

/** Deterministic pseudo-random numbers, so the example data is the same everywhere. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Example data for the workspace's `data/`: a count table (300 genes × 6 samples, 3 control and 3 treated, two
 * batches) where 30 genes go up and 20 go down under treatment, and some genes are too low to keep.
 */
export function exampleData(): { path: string; content: string }[] {
  const next = random(20260101);
  const normal = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  const samples = [
    { sample: "ctrl_1", condition: "control", batch: "A" },
    { sample: "ctrl_2", condition: "control", batch: "B" },
    { sample: "ctrl_3", condition: "control", batch: "A" },
    { sample: "treat_1", condition: "treated", batch: "B" },
    { sample: "treat_2", condition: "treated", batch: "A" },
    { sample: "treat_3", condition: "treated", batch: "B" },
  ];
  const depth = samples.map(() => 0.8 + next() * 0.5);
  const rows = ["gene_id\t" + samples.map((s) => s.sample).join("\t")];
  for (let g = 1; g <= 300; g++) {
    const base = g > 270 ? 2 + next() * 6 : Math.exp(3 + next() * 5);
    const effect = g <= 30 ? 2.5 : g <= 50 ? 0.35 : 1;
    const values = samples.map((s, i) => {
      const mean = base * depth[i]! * (s.condition === "treated" ? effect : 1) * Math.exp(normal() * 0.15);
      return Math.max(0, Math.round(mean));
    });
    rows.push(`GENE${String(g).padStart(4, "0")}\t${values.join("\t")}`);
  }
  return [
    { path: "data/counts.tsv", content: `${rows.join("\n")}\n` },
    { path: "data/samples.csv", content: `sample,condition,batch\n${samples.map((s) => `${s.sample},${s.condition},${s.batch}`).join("\n")}\n` },
  ];
}
