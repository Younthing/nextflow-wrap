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
  /** Project (workspace folder) the notebook belongs to. Unset on notebooks from before projects: see `notebookProjectId`. */
  projectId?: string;
  /**
   * Opened to edit a module (from the module library or a canvas node): kept out of the project's notebooks and
   * files until it is saved there.
   */
  temporary?: boolean;
  /** Module this notebook was opened from: only the default target of its next export. Nothing syncs. */
  fromModuleId?: string;
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
  projectId: string;
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

/** Where a try-run input port got its value. */
export type TryRunInputSource = "upload" | "path" | "sample";

/** One port's binding, stored on the try-run so the log and the form can name the source. */
export interface TryRunInputBinding {
  port: string;
  source: TryRunInputSource;
  label: string;
}

/**
 * MIME types a cell output can carry, best first.
 * HTML, then SVG, then raster images, then PDF, then tables, then markdown, then plain text.
 */
export const OUTPUT_MIME_ORDER = [
  "text/html",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
  "text/tab-separated-values",
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
  /** Jupyter execution count, set when the cell ran in a persistent kernel. */
  executionCount?: number;
}

/** How a notebook run executed its cells. */
export interface NotebookRunKernel {
  /** `jupyter`: a persistent kernel keeps state between runs. `oneshot`: a fresh Python process from the top. */
  mode: "jupyter" | "oneshot";
  /** Kernelspec that ran the cells, for `jupyter`. */
  kernel?: string;
  /** Why the run did not use the requested kernel, or why it fell back to one-shot. */
  note?: string;
}

export interface NotebookRunResult {
  cells: CellRunResult[];
  kernel?: NotebookRunKernel;
}

export type KernelState = "stopped" | "starting" | "idle" | "busy" | "dead";

export interface KernelInfo {
  notebookId: string;
  state: KernelState;
  /** Kernel name stored on the notebook. */
  requested?: string;
  /** Jupyter kernelspec actually running. */
  kernel?: string;
  note?: string;
  python?: string;
  startedAt?: string;
}

export interface KernelSpec {
  name: string;
  displayName: string;
  language: string;
}

export interface KernelSpecList {
  /** False when the bridge interpreter has no jupyter_client. */
  available: boolean;
  python?: string;
  kernels: KernelSpec[];
  message?: string;
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
  /** Conda yaml the try-run was asked to use. Omitted when the field was blank. */
  condaYaml?: string;
  /** Container image the try-run was asked to use. Omitted when the field was blank. */
  containerImage?: string;
  /** Engine that actually started the CLI. Omitted when the run was refused. */
  envVia?: "host" | "conda" | "container";
  /** Input port bindings used for this try-run. */
  bindings?: TryRunInputBinding[];
}

/** Demo kernels: names the in-browser demo and its seed notebooks use. A real server lists its Jupyter kernels. */
export const KERNELS = {
  "py311-pandas": { label: "Python 3.11 · py311-pandas", language: "python" },
  "r-deseq2": { label: "R 4.3 · r-deseq2", language: "r" },
  "python3.11": { label: "python:3.11", language: "python" },
} as const;

export type KernelId = keyof typeof KERNELS;

export function kernelLabel(kernel: string): string {
  return kernel in KERNELS ? KERNELS[kernel as KernelId].label : kernel;
}

/** Standard Jupyter kernelspec names: ipykernel's `python3` and IRkernel's `ir`. */
export const DEFAULT_KERNEL: Record<NotebookLanguage, string> = { python: "python3", r: "ir" };

export function languageForKernel(kernel: string): NotebookLanguage {
  if (kernel in KERNELS) return KERNELS[kernel as KernelId].language;
  const name = kernel.trim().toLowerCase();
  if (
    name === "ir"
    || name.startsWith("r ")
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
