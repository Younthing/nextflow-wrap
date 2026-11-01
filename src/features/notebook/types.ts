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

/**
 * MIME types a cell output can carry, best first.
 * Same order as the notebook UI reference: HTML, then SVG, then raster images,
 * then markdown, then plain text.
 */
export const OUTPUT_MIME_ORDER = [
  "text/html",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/markdown",
  "text/plain",
] as const;

export type OutputMimeType = (typeof OUTPUT_MIME_ORDER)[number];

/** One Jupyter-style mime bundle. Image payloads are base64 except SVG, which is markup. */
export type CellMimeBundle = Partial<Record<OutputMimeType, string>>;

export type CellOutput =
  | { outputType: "stream"; name: "stdout" | "stderr"; text: string }
  | { outputType: "display_data" | "execute_result"; data: CellMimeBundle }
  | { outputType: "error"; traceback: string };

export interface CellRunResult {
  id: string;
  /** Captured stdout, kept for callers that only read text. */
  stdout: string;
  error?: string;
  /** Ordered stream, display, and error segments. */
  outputs?: CellOutput[];
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
  "r-deseq2": { label: "R 4.3 · r-deseq2", language: "r" },
  "python3.11": { label: "python:3.11", language: "python" },
} as const;

export type KernelId = keyof typeof KERNELS;

export function kernelLabel(kernel: string): string {
  return kernel in KERNELS ? KERNELS[kernel as KernelId].label : kernel;
}

export function languageForKernel(kernel: string): NotebookLanguage {
  if (kernel in KERNELS) return KERNELS[kernel as KernelId].language;
  const name = kernel.trim().toLowerCase();
  if (
    name.startsWith("r ")
    || name.startsWith("r:")
    || name.startsWith("r-")
    || name.startsWith("r.")
    || name.includes("rscript")
    || name.includes("irkernel")
  ) return "r";
  return "python";
}

/** Kernel names are stored on the notebook. They are not conda paths or image refs. */
export function normalizeKernelName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("内核名称不能为空");
  if (name.length > 80) throw new Error("内核名称过长");
  if (/[\u0000-\u001f]/.test(name)) throw new Error("内核名称不能包含换行");
  return name;
}
