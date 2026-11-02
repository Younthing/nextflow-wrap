import type { ModuleIndex } from "@/features/workflow/catalog";
import type { WorkflowDoc } from "@/features/workflow/types";
import type { ResultFile, TaskRecord } from "./types";

/** Where a result came from: the canvas node, its module version, the notebook revision, and the tasks. */
export interface ResultSource {
  nodeId: string;
  alias: string;
  moduleId: string;
  moduleName?: string;
  version?: string;
  notebook?: { id: string; rev?: number };
  tasks: TaskRecord[];
}

/** Nextflow names processes `ALIAS` or `WORKFLOW:ALIAS`, and tasks `ALIAS (tag)`. */
const processAlias = (process: string) => process.split(":").at(-1) ?? process;

export function traceResult(file: Pick<ResultFile, "path" | "nodeId">, workflow: WorkflowDoc, index: ModuleIndex | undefined, tasks: TaskRecord[]): ResultSource | undefined {
  const node = workflow.nodes.find((candidate) => candidate.id === file.nodeId)
    ?? workflow.nodes.find((candidate) => file.path.startsWith(`${candidate.data.alias.toLowerCase()}/`));
  if (!node) return undefined;
  const def = index?.get(node.data.moduleId);
  const file_name = file.path.split("/").at(-1) ?? "";
  const own = tasks.filter((task) => processAlias(task.process) === node.data.alias);
  // A sample-named file (`PBMC_1.h5ad`) narrows the tasks to the one with that tag.
  const tagged = own.filter((task) => task.tag && file_name.startsWith(task.tag));
  return {
    nodeId: node.id,
    alias: node.data.alias,
    moduleId: node.data.moduleId,
    moduleName: def?.name,
    version: def?.version,
    notebook: def?.sourceNotebookId ? { id: def.sourceNotebookId, rev: def.sourceNotebookRev } : undefined,
    tasks: tagged.length ? tagged : own,
  };
}

const quote = (path: string) => JSON.stringify(path);

/** Code that loads a result in a Python notebook, to continue the analysis where the pipeline stopped. */
export function notebookSnippet(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".h5ad")) return `import scanpy as sc\nadata = sc.read_h5ad(${quote(path)})\nadata`;
  if (lower.endsWith(".loom")) return `import scanpy as sc\nadata = sc.read_loom(${quote(path)})\nadata`;
  if (lower.endsWith(".csv")) return `import pandas as pd\ndf = pd.read_csv(${quote(path)})\ndf.head()`;
  if (lower.endsWith(".tsv") || lower.endsWith(".txt")) return `import pandas as pd\ndf = pd.read_csv(${quote(path)}, sep="\\t")\ndf.head()`;
  if (lower.endsWith(".parquet")) return `import pandas as pd\ndf = pd.read_parquet(${quote(path)})\ndf.head()`;
  if (/\.(pdb|pdbqt|sdf|mol2)$/.test(lower)) return `from pathlib import Path\nstructure = Path(${quote(path)}).read_text()\nprint(structure[:500])`;
  if (/\.(png|jpe?g|svg)$/.test(lower)) return `from IPython.display import Image\nImage(filename=${quote(path)})`;
  return `from pathlib import Path\npath = Path(${quote(path)})\npath`;
}
