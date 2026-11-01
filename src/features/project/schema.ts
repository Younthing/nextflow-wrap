import type { JsonSchema } from "@/features/workflow/queries";
import { declaredParam } from "@/features/workflow/operators";
import type { WorkflowDoc } from "@/features/workflow/types";
import { REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";

export interface ReferenceParam {
  name: string;
  format: string;
  nodeAlias: string;
}

export function referenceParams(doc: Pick<WorkflowDoc, "nodes">): ReferenceParam[] {
  const seen = new Set<string>();
  const out: ReferenceParam[] = [];
  for (const n of doc.nodes) {
    if (n.data.moduleId !== REFERENCE_ID || n.data.disabled) continue;
    const name = String(n.data.settings?.param ?? "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, format: String(n.data.settings?.format ?? "other"), nodeAlias: n.data.alias });
  }
  return out;
}

const FORMAT_PATTERNS: Record<string, string> = {
  fasta: "^\\S+\\.(fa|fasta|fna)(\\.gz)?$",
  gtf: "^\\S+\\.(gtf|gff3?)(\\.gz)?$",
  fai: "^\\S+\\.fai$",
  bed: "^\\S+\\.bed(\\.gz)?$",
  vcf: "^\\S+\\.vcf(\\.gz)?$",
};

const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: "string",
  description,
  ...extra,
});
const bool = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: "boolean",
  description,
  ...extra,
});

/**
 * nextflow_schema.json for a generated project: input/output, reference files
 * and operator params from the canvas. The editor renders its params form from
 * this same schema; the app validates params against it before a run.
 */
export interface ExtraParam {
  name: string;
  description: string;
  kind: "boolean" | "file" | "string";
}

const PARAM_NAME = /^[a-z][a-z0-9_]*$/;

/** Params introduced by channel operators and runtime skip flags. */
export function patternParams(doc: Pick<WorkflowDoc, "nodes">): ExtraParam[] {
  const out: ExtraParam[] = [];
  const seen = new Set<string>();
  const add = (param: ExtraParam) => {
    if (!PARAM_NAME.test(param.name) || seen.has(param.name)) return;
    seen.add(param.name);
    out.push(param);
  };
  for (const node of doc.nodes) {
    if (node.data.disabled) continue;
    const declared = declaredParam(node.data.moduleId, node.data.settings);
    if (declared) {
      add({
        name: declared.name,
        description: `Input for ${node.data.alias}.`,
        kind: declared.file ? "file" : "string",
      });
    }
    if (node.data.config.skip) {
      add({
        name: `skip_${node.data.alias.toLowerCase()}`,
        description: `Skip ${node.data.alias} and pass its input to the next process.`,
        kind: "boolean",
      });
    }
  }
  return out;
}

/** Whether the canvas reads a samplesheet, so the pipeline needs `--input`. */
export function usesSamplesheet(doc: Pick<WorkflowDoc, "nodes">): boolean {
  return doc.nodes.some((node) => node.data.moduleId === SAMPLESHEET_ID && !node.data.disabled);
}

export function buildParamsSchema(
  name: string,
  description: string,
  refs: ReferenceParam[],
  extras: ExtraParam[] = [],
  opts: { input?: boolean } = {},
): JsonSchema & Record<string, unknown> {
  const io: Record<string, JsonSchema> = {};
  if (opts.input) {
    io.input = str("Path to the comma-separated samplesheet: one row per sample.", {
      format: "file-path",
      exists: true,
      schema: "assets/schema_input.json",
      mimetype: "text/csv",
      pattern: "^\\S+\\.csv$",
      fa_icon: "fas fa-file-csv",
      help_text: "CSV with columns sample, fastq_1 and fastq_2.",
    });
  }
  io.outdir = str("The output directory where the results will be saved. Use absolute paths on cluster or cloud storage.", {
    format: "directory-path",
    fa_icon: "fas fa-folder-open",
  });
  const defs: Record<string, JsonSchema & Record<string, unknown>> = {
    input_output_options: {
      title: "Input/output options",
      type: "object",
      fa_icon: "fas fa-terminal",
      description: "Define where the pipeline should find input data and save output data.",
      required: opts.input ? ["input", "outdir"] : ["outdir"],
      properties: io,
    },
  };
  if (refs.length) {
    defs.reference_files = {
      title: "Reference files",
      type: "object",
      fa_icon: "fas fa-dna",
      description: "Reference files used by the pipeline.",
      properties: Object.fromEntries(
        refs.map((r) => [
          r.name,
          str(`Path to the ${r.format === "other" ? "reference" : r.format.toUpperCase()} file (used by ${r.nodeAlias}).`, {
            format: "file-path",
            exists: true,
            ...(FORMAT_PATTERNS[r.format] ? { pattern: FORMAT_PATTERNS[r.format] } : {}),
            fa_icon: "far fa-file-code",
          }),
        ]),
      ),
    };
  }
  if (extras.length) {
    defs.channel_inputs = {
      title: "Channel inputs",
      type: "object",
      fa_icon: "fas fa-code-branch",
      description: "Files and flags read by channel operators.",
      properties: Object.fromEntries(
        extras.map((extra) => {
          if (extra.kind === "boolean") return [extra.name, bool(extra.description, { default: false })];
          if (extra.kind === "file") return [extra.name, str(extra.description, { format: "file-path" })];
          return [extra.name, str(extra.description)];
        }),
      ),
    };
  }
  defs.generic_options = {
    title: "Generic options",
    type: "object",
    fa_icon: "fas fa-file-import",
    description: "Less common options for the pipeline, typically set in a config file.",
    properties: {
      publish_dir_mode: str("Method used to save pipeline results to output directory.", {
        default: "copy",
        enum: ["symlink", "rellink", "link", "copy", "copyNoFollow", "move"],
        hidden: true,
      }),
      trace_report_suffix: str("Suffix for the execution report file names. Defaults to the date and time.", {
        hidden: true,
      }),
    },
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://raw.githubusercontent.com/${name}/main/nextflow_schema.json`,
    title: `${name} pipeline parameters`,
    description,
    type: "object",
    $defs: defs,
    allOf: Object.keys(defs).map((k) => ({ $ref: `#/$defs/${k}` })),
  };
}

/** Groovy expressions for params whose default is computed at run time. */
const COMPUTED_DEFAULTS: Record<string, string> = {
  trace_report_suffix: "new java.util.Date().format( 'yyyy-MM-dd_HH-mm-ss')",
};

/** The `params { }` body of nextflow.config, mirroring the schema. */
export function paramsBlock(schema: JsonSchema): string {
  const lines: string[] = [];
  for (const [id, group] of Object.entries(schema.$defs ?? {})) {
    const props = Object.entries(group.properties ?? {});
    if (!props.length) continue;
    lines.push(`    // ${group.title ?? id}`);
    const width = Math.max(...props.map(([k]) => k.length));
    for (const [key, spec] of props) {
      let value: string;
      if (COMPUTED_DEFAULTS[key]) value = COMPUTED_DEFAULTS[key];
      else if (spec.default === undefined) value = spec.type === "boolean" || (Array.isArray(spec.type) && spec.type[0] === "boolean") ? "false" : "null";
      else if (typeof spec.default === "string") value = `'${spec.default}'`;
      else value = String(spec.default);
      lines.push(`    ${key.padEnd(width)} = ${value}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
