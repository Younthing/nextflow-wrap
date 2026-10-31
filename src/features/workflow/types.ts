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
}

export interface ToolInfo {
  name: string;
  description: string;
  homepage?: string;
  doi?: string;
  licence?: string[];
}

export interface ModuleDef {
  /** `nf-core/<path>` for nf-core modules, `builtin/<name>` otherwise. */
  id: string;
  /** Path under modules/nf-core, e.g. `star/align`. Empty for built-ins. */
  path: string;
  name: string;
  /** Nextflow process name, e.g. `STAR_ALIGN`. */
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
  /** Host-command process used to exercise patterns. Not an nf-core module. */
  temporary?: boolean;
}

export interface ModuleCatalog {
  source: string;
  /** nf-core/modules commit the catalog was read from. */
  gitSha: string;
  syncedAt: string;
  modules: ModuleDef[];
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

/** How the workflow is published as an nf-core style pipeline. */
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
