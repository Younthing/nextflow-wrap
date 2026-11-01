import type { ModuleDef, WorkflowNode } from "./types";

const file = (name: string, format?: string) => ({
  name,
  type: "file",
  kind: "file" as const,
  description: name,
  format,
});

/** Functional builtins shown ahead of nf-core. Names match the IA v3 catalog. */
export const CATALOG_BUILTINS: ModuleDef[] = [
  {
    id: "builtin/merge-samplesheet",
    path: "",
    name: "合并样本表",
    process: "MERGE_SAMPLESHEET",
    category: "内置",
    description: "多张样本表按 sample 列合并去重，写出一张 samplesheet.csv。",
    keywords: ["samplesheet", "merge", "csv"],
    tools: [],
    origin: "builtin",
    builtin: true,
    inputs: [
      {
        name: "sheets",
        description: "一张或多张样本表",
        collect: true,
        elements: [file("sheets", "csv")],
      },
    ],
    outputs: [
      {
        name: "samplesheet",
        description: "合并后的样本表",
        elements: [file("samplesheet", "csv")],
      },
    ],
  },
  {
    id: "builtin/branch",
    path: "",
    name: "按条件分支",
    process: "BRANCH",
    category: "内置",
    description: "按条件把一组条目分成通过和其余两路。",
    keywords: ["branch", "filter"],
    tools: [],
    origin: "builtin",
    builtin: true,
    inputs: [
      {
        name: "items",
        description: "待拆分的文件",
        collect: true,
        elements: [file("items")],
      },
      {
        name: "condition",
        description: "分支条件",
        widget: "string",
        elements: [{ name: "condition", type: "string", kind: "value", description: "条件" }],
      },
    ],
    outputs: [
      { name: "matched", description: "条件命中的条目", elements: [file("matched")] },
      { name: "rest", description: "其余条目", elements: [file("rest")] },
    ],
  },
  {
    id: "builtin/collect-summary",
    path: "",
    name: "收集汇总",
    process: "COLLECT_SUMMARY",
    category: "内置",
    description: "把上游多份结果收成一组再往下传。",
    keywords: ["collect", "summary"],
    tools: [],
    origin: "builtin",
    builtin: true,
    inputs: [
      {
        name: "files",
        description: "多份上游结果",
        collect: true,
        elements: [file("files")],
      },
    ],
    outputs: [
      { name: "files", description: "收成一组的文件", elements: [file("files")] },
    ],
  },
  {
    id: "builtin/export-results",
    path: "",
    name: "导出结果",
    process: "EXPORT_RESULTS",
    category: "内置",
    description: "把产物复制到结果目录并生成 manifest.tsv。",
    keywords: ["publish", "export", "manifest"],
    tools: [],
    origin: "builtin",
    builtin: true,
    inputs: [
      {
        name: "files",
        description: "要导出的文件",
        collect: true,
        elements: [file("files")],
      },
    ],
    outputs: [
      { name: "manifest", description: "结果清单", elements: [file("manifest", "tsv")] },
    ],
  },
];

export const CATALOG_BUILTIN_IDS = new Set(CATALOG_BUILTINS.map((mod) => mod.id));

function scriptFor(id: string, alias: string): string {
  if (id === "builtin/merge-samplesheet") {
    return `cat \${sheets} > samplesheet.csv 2>/dev/null || true\ntouch samplesheet.csv\necho ${alias} >> samplesheet.csv`;
  }
  if (id === "builtin/branch") {
    return `touch matched rest\ncp -f \${items} matched 2>/dev/null || true`;
  }
  if (id === "builtin/collect-summary") {
    return `mkdir -p collected\ncp -f \${files} collected/ 2>/dev/null || true\ntouch collected/summary.txt`;
  }
  return `mkdir -p results\ncp -f \${files} results/ 2>/dev/null || true\nprintf "file\\n%s\\n" results > manifest.tsv`;
}

/** Local processes for the four catalog builtins. Hidden from the notebook UI. */
export function renderCatalogBuiltinProcesses(nodes: { node: WorkflowNode; def: ModuleDef }[]): string {
  return nodes
    .filter((planned) => CATALOG_BUILTIN_IDS.has(planned.def.id))
    .map(({ node, def }) => {
      const inputs = def.inputs.map((port) => (port.widget ? `val ${port.name}` : `path ${port.name}`));
      const outputs = def.outputs.map((port) => {
        const filename = port.name === "samplesheet" ? "samplesheet.csv" : port.name === "manifest" ? "manifest.tsv" : port.name === "files" ? "collected/*" : port.name;
        return `path '${filename}', emit: ${port.name}`;
      });
      return `// BUILTIN: ${node.data.alias} (${def.id})
process ${node.data.alias} {
    input:
    ${inputs.join("\n    ")}
    output:
    ${outputs.join("\n    ")}
    script:
    """
    ${scriptFor(def.id, node.data.alias)}
    """
}`;
    })
    .join("\n\n");
}
