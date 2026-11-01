/** What an element of a channel tuple carries. */
export type ElementKind = "meta" | "file" | "value";

export interface ChannelElement {
  name: string;
  /** Raw type from meta.yml (file, directory, map, string, boolean, …). */
  type: string;
  kind: ElementKind;
  description: string;
  pattern?: string;
  /** Rough file format (bam, fastq, …) guessed from the pattern. */
  format?: string;
}

export interface PortDef {
  name: string;
  description: string;
  /** Tuple elements in order; a plain channel has a single element. */
  elements: ChannelElement[];
  /** Accepts many links whose items are mixed and collected (e.g. MultiQC). */
  collect?: boolean;
  /** Value-only inputs render as an inline widget instead of a socket. */
  widget?: string;
  /** Initial widget value on a new node, such as a notebook input's declared default. */
  default?: WidgetValue;
}

export interface ToolInfo {
  name: string;
  description: string;
  homepage?: string;
  doi?: string;
  licence?: string[];
}

/** Where a module comes from. Older rows omit this; `moduleOrigin` infers it from the id. */
export type ModuleOrigin = "builtin" | "script";

/** Result of the publish try-run. Failed script modules stay in the catalog but are not draggable. */
export type TryRunStatus = "passed" | "failed";

export interface ModuleDef {
  /** `builtin/<name>` or `script/<notebook>/<version>`. */
  id: string;
  /** Folder under modules/local for published notebooks. Empty for built-ins. */
  path: string;
  name: string;
  /** Nextflow process name, e.g. `SCANPY_QC`. */
  process: string;
  category: string;
  description: string;
  keywords: string[];
  tools: ToolInfo[];
  label?: string;
  container?: string;
  /** How the module reports tool versions: the `versions` topic or a versions.yml emit. */
  versions?: "topic" | "emit";
  inputs: PortDef[];
  outputs: PortDef[];
  builtin?: boolean;
  /** Host-command process used to exercise patterns. */
  temporary?: boolean;
  /** Builtin functional node or a notebook-published CLI. */
  origin?: ModuleOrigin;
  /** Notebook that published this script module. */
  sourceNotebookId?: string;
  /** Notebook revision pinned at publish time. */
  sourceNotebookRev?: number;
  /** Published label, for example `v1`. */
  version?: string;
  tryRun?: TryRunStatus;
  /** CLI entry inside a generated project, for example `bin/qc_summary.py`. */
  command?: string;
  /** Generated script. The canvas never shows this; Nextflow calls it. */
  script?: string;
  /** Kernel id copied from the source notebook. It does not set process `conda` or `container`. */
  kernel?: string;
  /** Conda environment yaml path for the process `conda` directive. Hand-filled, not taken from the kernel. */
  condaYaml?: string;
  /** Container image for the process `container` directive. Hand-filled, not taken from the kernel. */
  containerImage?: string;
  /** Free-text note saved with this published version. */
  changelog?: string;
}

export type WidgetValue = string | number | boolean;

/** One publishDir entry. Path and saveAs are Groovy expressions, not quoted strings. */
export interface PublishDir {
  /** Directory expression, for example `${params.outdir}/${meta.id}`. */
  path: string;
  /** Glob; only matching files are stored in this directory. */
  pattern?: string;
  /** Closure body `filename -> ...`. `null` drops the file. */
  saveAs?: string;
}

/** Per-node settings that end up in conf/modules.config. */
export interface NodeConfig {
  /** Extra command-line arguments, `ext.args`. */
  args?: string;
  /** Output file prefix, `ext.prefix`. */
  prefix?: string;
  /** Publish the node's outputs under `${params.outdir}`. */
  publish?: boolean;
  /** Override the module's resource label. */
  label?: string;
  /** Process `errorStrategy`, for example `ignore`. */
  errorStrategy?: string;
  /** Groovy expression for the `when` directive. */
  when?: string;
  /** Feed `ifEmpty('EMPTY')` and run only when that marker arrives. */
  whenEmpty?: boolean;
  /** Skip at runtime via `params.skip_<alias>` and mix the input downstream. */
  skip?: boolean;
  /** Dynamic `memory` closure body, for example `reads.size() < 70.KB ? 1.GB : 5.GB`. */
  memory?: string;
  /** Dynamic `cpus` closure body. */
  cpus?: string;
  /** Comma-separated output ports that may be missing. Consumers use `ifEmpty`. */
  optionalOutputs?: string;
  /** Override the publish directory expression. */
  publishPath?: string;
  /** Glob for the primary publishDir. */
  publishPattern?: string;
  /** `saveAs` closure body for the primary publishDir. */
  publishSaveAs?: string;
  /** Extra publish directories (pattern 21). Combined with the primary rule. */
  publishDirs?: PublishDir[];
}

export interface WorkflowNodeData {
  moduleId: string;
  /** Unique process alias used for `include { X as ALIAS }`. */
  alias: string;
  widgets: Record<string, WidgetValue>;
  config: NodeConfig;
  /** Built-in nodes keep their own settings (param name, format, …). */
  settings?: Record<string, WidgetValue>;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface WorkflowNode {
  id: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export type PipelineParams = Record<string, WidgetValue>;

/** How the workflow is published as a Nextflow project. */
export interface ProjectSettings {
  /** Repository-style name, e.g. `studio/rnaseq`. */
  name: string;
  version: string;
  author: string;
}

export interface WorkflowDoc {
  id: string;
  name: string;
  description?: string;
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  params: PipelineParams;
  project?: ProjectSettings;
  updatedAt: string;
}

export type WorkflowSummary = Pick<
  WorkflowDoc,
  "id" | "name" | "description" | "updatedAt"
> & { nodeCount: number };
