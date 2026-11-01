export type NotebookLanguage = "python" | "r";

/** What a cell contributes. Markdown and explore cells stay in the notebook and are dropped at publish. */
export type NotebookCellRole = "code" | "markdown" | "input" | "output" | "explore";

export interface NotebookCell {
  id: string;
  role: NotebookCellRole;
  source: string;
}

export interface NotebookDoc {
  id: string;
  name: string;
  description: string;
  /** Kernel id, for example `py311-pandas`. */
  kernel: string;
  language: NotebookLanguage;
  cells: NotebookCell[];
  /** Monotonic content revision. Bumps only when cells change. */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookRevision {
  notebookId: string;
  rev: number;
  cells: NotebookCell[];
  savedAt: string;
}

export interface NotebookSummary {
  id: string;
  name: string;
  description: string;
  kernel: string;
  language: NotebookLanguage;
  rev: number;
  updatedAt: string;
  publishState: "analysis" | "published";
  publishedVersion?: string;
  tryRun?: "passed" | "failed";
  moduleName?: string;
  moduleId?: string;
}

export interface MarkerInput {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface MarkerOutput {
  name: string;
  type: string;
  pattern: string;
}

export interface CellRef {
  index: number;
  id: string;
  role: NotebookCellRole;
}

export interface ConvertedNotebook {
  language: NotebookLanguage;
  entry: string;
  script: string;
  /** Shell-shaped preview. Not executed as a shell string. */
  commandPreview: string;
  inputs: MarkerInput[];
  outputs: MarkerOutput[];
  included: CellRef[];
  excluded: CellRef[];
}

export interface TryRunOutput {
  name: string;
  file: string;
  bytes: number;
  ok: boolean;
  message?: string;
}

export interface CellRunResult {
  id: string;
  stdout: string;
  error?: string;
}

export interface TryRunRecord {
  notebookId: string;
  rev: number;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  log: string;
  outputs: TryRunOutput[];
  ranAt: string;
}

export const KERNELS = {
  "py311-pandas": { label: "Python 3.11 · py311-pandas", language: "python" },
  "python3.11": { label: "Python 3.11", language: "python" },
  "r-deseq2": { label: "R · r-deseq2", language: "r" },
} as const;

export type KernelId = keyof typeof KERNELS;

export function kernelLabel(kernel: string): string {
  return kernel in KERNELS ? KERNELS[kernel as KernelId].label : kernel;
}

export function languageForKernel(kernel: string): NotebookLanguage {
  return kernel in KERNELS ? KERNELS[kernel as KernelId].language : "python";
}
