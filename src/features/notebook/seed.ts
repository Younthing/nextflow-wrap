import type { ModuleDef } from "@/features/workflow/types";
import { countCellChanges } from "./changes";
import { convertNotebook, inputPorts, outputPorts } from "./convert";
import { processName } from "./publish";
import type { NotebookCell, NotebookDoc, NotebookRevision } from "./types";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function notebook(partial: Omit<NotebookDoc, "createdAt"> & { createdAt?: string }): NotebookDoc {
  return { createdAt: partial.updatedAt, ...partial };
}

const qcCurrent: NotebookCell[] = [
  {
    id: "c1",
    role: "input",
    source: `# @input name=fastq_zip type=path[] required
# @input name=min_q type=int default=30
# @input name=title type=str default="QC 汇总"
fastq_zip = ["samples/S1_fastq.zip", "samples/S2_fastq.zip"]
min_q = 30
title = "QC 汇总"
`,
  },
  {
    id: "c2",
    role: "code",
    source: `import os
rows = []
for path in fastq_zip:
    mean_q = 34.2 if "S1" in os.path.basename(path) else 28.7
    rows.append({"sample": os.path.basename(path), "mean_q": mean_q, "passed": mean_q >= min_q})
`,
  },
  {
    id: "c3",
    role: "explore",
    source: `# 只在笔记本里看，发布时排除
print("explore", len(rows) if "rows" in dir() else 0)
`,
  },
  {
    id: "c4",
    role: "output",
    source: `# @output name=report type=path pattern="report.html"
# @output name=stats type=path pattern="stats.tsv"
with open("stats.tsv", "w", encoding="utf-8") as handle:
    handle.write("sample\\tmean_q\\tpassed\\n")
    for row in rows:
        handle.write(f"{row['sample']}\\t{row['mean_q']}\\t{row['passed']}\\n")
html = f"<html><head><title>{title}</title></head><body><h1>{title}</h1><p>{len(rows)} samples</p></body></html>"
with open("report.html", "w", encoding="utf-8") as handle:
    handle.write(html)
`,
  },
];

const qcPinned: NotebookCell[] = [
  qcCurrent[0],
  {
    ...qcCurrent[1],
    source: `import os
rows = []
for path in fastq_zip:
    mean_q = 30
    rows.append({"sample": os.path.basename(path), "mean_q": mean_q, "passed": mean_q >= min_q})
`,
  },
  {
    ...qcCurrent[2],
    source: `# 探索草稿
print("draft")
`,
  },
  {
    ...qcCurrent[3],
    source: qcCurrent[3].source.replace("<h1>{title}</h1>", "<h1>draft {title}</h1>"),
  },
];

const helloCells: NotebookCell[] = [
  {
    id: "h1",
    role: "input",
    source: `# @input name=samplesheet type=path required
samplesheet = "samplesheet.csv"
`,
  },
  {
    id: "h2",
    role: "output",
    source: `# @output name=hello type=path pattern="hello.txt"
header = open(samplesheet, encoding="utf-8").read().splitlines()[0]
open("hello.txt", "w", encoding="utf-8").write(f"hello {header}\\n")
`,
  },
];

const deseqCells: NotebookCell[] = [
  {
    id: "d1",
    role: "input",
    source: `# @input name=counts type=path required
# @input name=design type=path required
counts <- "counts.tsv"
design <- "design.csv"
`,
  },
  {
    id: "d2",
    role: "output",
    source: `# @output name=volcano type=path pattern="volcano.pdf"
stop("试跑失败：未安装 DESeq2")
`,
  },
];

const cleanCells: NotebookCell[] = [
  {
    id: "s1",
    role: "code",
    source: `rows = [
    "sample,fastq_1,fastq_2,strand",
    "S1,S1_R1.fastq.gz,S1_R2.fastq.gz,auto",
    "S1,S1_R1.fastq.gz,S1_R2.fastq.gz,auto",
    "S2,S2_R1.fastq.gz,S2_R2.fastq.gz,auto",
]
header, *body = [row.split(",") for row in rows]
seen = set()
kept = []
for cells in body:
    if cells[0] in seen:
        continue
    seen.add(cells[0])
    kept.append(cells)
print(len(body), len(kept))
`,
  },
  {
    id: "s2",
    role: "markdown",
    source: "S1 重复了一行，已去掉。下一步看 strand 列要不要统一成 reverse。",
  },
];

export function demoNotebooks(now = Date.now()): NotebookDoc[] {
  const at = (ms: number) => new Date(now - ms).toISOString();
  return [
    notebook({
      id: "qc_summary",
      name: "qc_summary",
      description: "汇总 FastQC 结果出报告",
      kernel: "py311-pandas",
      language: "python",
      cells: qcCurrent,
      rev: 15,
      updatedAt: at(10 * MINUTE),
    }),
    notebook({
      id: "rnaseq_explore",
      name: "rnaseq_探索_1031",
      description: "看 counts 分布、挑阈值",
      kernel: "r-deseq2",
      language: "r",
      cells: [{ id: "e1", role: "code", source: "# counts <- read.delim('counts.tsv')\nprint('explore only')\n" }],
      rev: 3,
      updatedAt: at(HOUR),
    }),
    notebook({
      id: "tumor_plot",
      name: "tumor_vs_normal_图",
      description: "肿瘤／正常差异结果出图",
      kernel: "r-deseq2",
      language: "r",
      cells: [{ id: "t1", role: "code", source: "plot(1:10)\n" }],
      rev: 2,
      updatedAt: at(DAY),
    }),
    notebook({
      id: "hello_py",
      name: "hello.py",
      description: "读样本表输出问候文本",
      kernel: "python3.11",
      language: "python",
      cells: helloCells,
      rev: 4,
      updatedAt: at(DAY),
    }),
    notebook({
      id: "deseq2_plot",
      name: "deseq2_plot",
      description: "R：差异表达火山图",
      kernel: "r-deseq2",
      language: "r",
      cells: deseqCells,
      rev: 6,
      updatedAt: at(3 * DAY),
    }),
    notebook({
      id: "sample_clean",
      name: "样本表清洗",
      description: "修列名、去重复样本",
      kernel: "py311-pandas",
      language: "python",
      cells: cleanCells,
      rev: 2,
      updatedAt: at(5 * DAY),
    }),
    notebook({
      id: "batch_compare",
      name: "临时_对比两批测序",
      description: "一次性对比，不打算复用",
      kernel: "py311-pandas",
      language: "python",
      cells: [{ id: "b1", role: "code", source: "print('one-off')\n" }],
      rev: 1,
      updatedAt: at(8 * DAY),
    }),
  ];
}

export function demoRevisions(notebooks = demoNotebooks()): NotebookRevision[] {
  const revisions: NotebookRevision[] = [];
  for (const doc of notebooks) {
    revisions.push({ notebookId: doc.id, rev: doc.rev, cells: doc.cells, savedAt: doc.updatedAt });
  }
  const qc = notebooks.find((doc) => doc.id === "qc_summary");
  if (qc) {
    revisions.push({ notebookId: qc.id, rev: 12, cells: qcPinned, savedAt: ago(2 * DAY) });
  }
  return revisions;
}

function published(notebook: NotebookDoc, version: string, tryRun: "passed" | "failed", rev: number): ModuleDef {
  const converted = convertNotebook({ ...notebook, rev }, `bin/${notebook.id}_${version}.${notebook.language === "r" ? "R" : "py"}`);
  return {
    id: `script/${notebook.id}/${version}`,
    path: `${notebook.id}_${version}`,
    name: notebook.name,
    process: processName(notebook.name),
    category: "自定义",
    description: notebook.description,
    keywords: ["notebook", notebook.id],
    tools: [],
    origin: "script",
    inputs: inputPorts(converted.inputs),
    outputs: outputPorts(converted.outputs),
    sourceNotebookId: notebook.id,
    sourceNotebookRev: rev,
    version,
    tryRun,
    command: converted.entry,
    script: converted.script,
    kernel: notebook.kernel,
    label: "process_low",
  };
}

export function demoScriptModules(notebooks = demoNotebooks()): ModuleDef[] {
  const byId = new Map(notebooks.map((doc) => [doc.id, doc]));
  return [
    published(byId.get("qc_summary")!, "v1", "passed", 12),
    published(byId.get("hello_py")!, "v2", "passed", byId.get("hello_py")!.rev),
    published(byId.get("deseq2_plot")!, "v1", "failed", byId.get("deseq2_plot")!.rev),
  ];
}

export function qcPinnedCellChanges(notebooks = demoNotebooks(), revisions = demoRevisions(notebooks)): number {
  const latest = notebooks.find((doc) => doc.id === "qc_summary")!;
  const pinned = revisions.find((rev) => rev.notebookId === "qc_summary" && rev.rev === 12)!;
  return countCellChanges(pinned.cells, latest.cells);
}
