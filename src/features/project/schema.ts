import type { JsonSchema } from "@/features/workflow/queries";
import { declaredParam } from "@/features/workflow/operators";
import type { WorkflowDoc } from "@/features/workflow/types";
import { REFERENCE_ID } from "@/features/workflow/builtins";

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
 * nextflow_schema.json for a generated project: the nf-core template groups
 * plus one group for reference files added on the canvas. The editor renders
 * its params form from this same schema.
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

export function buildParamsSchema(
  name: string,
  description: string,
  refs: ReferenceParam[],
  extras: ExtraParam[] = [],
): JsonSchema & Record<string, unknown> {
  const defs: Record<string, JsonSchema & Record<string, unknown>> = {
    input_output_options: {
      title: "Input/output options",
      type: "object",
      fa_icon: "fas fa-terminal",
      description: "Define where the pipeline should find input data and save output data.",
      required: ["input", "outdir"],
      properties: {
        input: str("Path to comma-separated file containing information about the samples in the experiment.", {
          format: "file-path",
          exists: true,
          schema: "assets/schema_input.json",
          mimetype: "text/csv",
          pattern: "^\\S+\\.csv$",
          fa_icon: "fas fa-file-csv",
          help_text: "CSV with columns sample, fastq_1 and fastq_2. One row per FastQ pair.",
        }),
        outdir: str("The output directory where the results will be saved. You have to use absolute paths to storage on Cloud infrastructure.", {
          format: "directory-path",
          fa_icon: "fas fa-folder-open",
        }),
        email: str("Email address for completion summary.", {
          fa_icon: "fas fa-envelope",
          pattern: "^([a-zA-Z0-9_\\-\\.]+)@([a-zA-Z0-9_\\-\\.]+)\\.([a-zA-Z]{2,5})$",
        }),
        multiqc_title: str("MultiQC report title. Printed as page header, used for filename if not otherwise specified.", {
          fa_icon: "fas fa-file-signature",
        }),
      },
    },
  };

  if (refs.length) {
    defs.reference_files = {
      title: "Reference files",
      type: "object",
      fa_icon: "fas fa-dna",
      description: "Reference files used by the pipeline. Set them here or select an iGenomes key with --genome.",
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
    defs.reference_files.properties!.genome = str("Name of iGenomes reference.", { fa_icon: "fas fa-book", hidden: true });
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

  defs.institutional_config_options = {
    title: "Institutional config options",
    type: "object",
    fa_icon: "fas fa-university",
    description: "Parameters used to describe centralised config profiles. These should not be edited.",
    properties: {
      custom_config_version: str("Git commit id for Institutional configs.", { default: "master", hidden: true }),
      custom_config_base: str("Base directory for Institutional configs.", {
        default: "https://raw.githubusercontent.com/nf-core/configs/master",
        hidden: true,
      }),
      config_profile_name: str("Institutional config name.", { hidden: true }),
      config_profile_description: str("Institutional config description.", { hidden: true }),
      config_profile_contact: str("Institutional config contact information.", { hidden: true }),
      config_profile_url: str("Institutional config URL link.", { hidden: true }),
    },
  };

  defs.generic_options = {
    title: "Generic options",
    type: "object",
    fa_icon: "fas fa-file-import",
    description: "Less common options for the pipeline, typically set in a config file.",
    properties: {
      version: bool("Display version and exit.", { hidden: true }),
      publish_dir_mode: str("Method used to save pipeline results to output directory.", {
        default: "copy",
        enum: ["symlink", "rellink", "link", "copy", "copyNoFollow", "move"],
        hidden: true,
      }),
      email_on_fail: str("Email address for completion summary, only when pipeline fails.", { hidden: true }),
      plaintext_email: bool("Send plain-text email instead of HTML.", { hidden: true }),
      max_multiqc_email_size: str("File size limit when attaching MultiQC reports to summary emails.", {
        default: "25.MB",
        pattern: "^\\d+(\\.\\d+)?\\.?\\s*(K|M|G|T)?B$",
        hidden: true,
      }),
      monochrome_logs: bool("Do not use coloured log outputs.", { hidden: true }),
      multiqc_config: str("Custom config file to supply to MultiQC.", { format: "file-path", hidden: true }),
      multiqc_logo: str("Custom logo file to supply to MultiQC. File name must also be set in the MultiQC config file", {
        format: "file-path",
        hidden: true,
      }),
      multiqc_methods_description: str("Custom MultiQC yaml file containing HTML including a methods description.", {
        format: "file-path",
      }),
      validate_params: bool("Boolean whether to validate parameters against the schema at runtime", {
        default: true,
        hidden: true,
      }),
      pipelines_testdata_base_path: str("Base URL or local path to location of pipeline test dataset files", {
        default: "https://raw.githubusercontent.com/nf-core/test-datasets/",
        hidden: true,
      }),
      trace_report_suffix: str("Suffix to add to the trace report filename. Default is the date and time in the format yyyy-MM-dd_HH-mm-ss.", {
        hidden: true,
      }),
      help: { type: ["boolean", "string"], description: "Display the help message.", hidden: true },
      help_full: bool("Display the full detailed help message.", { hidden: true }),
      show_hidden: bool("Display hidden parameters in the help message (only works when --help or --help_full are provided).", {
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
  custom_config_base: '"https://raw.githubusercontent.com/nf-core/configs/${params.custom_config_version}"',
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
