import samplesheetSchema from "@/data/samplesheet-schema.json";
import type { ModuleIndex } from "@/features/workflow/catalog";
import type { NodeConfig, ProjectSettings, PublishDir, WorkflowDoc } from "@/features/workflow/types";
import { gdynamic, gstr, section } from "./groovy";
import { buildParamsSchema, paramsBlock, patternParams, referenceParams, usesSamplesheet } from "./schema";
import { LABEL_RESOURCES, SAMPLESHEET_CSV, baseConfig, nextflowConfig, type ProjectMeta } from "./templates";
import { scriptProjectFiles, type ScriptLayout } from "./script-process";
import { GenerateError, generateMainScript, planNodes } from "./workflow-script";

export { GenerateError };

export interface ProjectFile {
  path: string;
  content: string;
  language: "groovy" | "json" | "yaml" | "csv" | "markdown" | "text";
  /** Written with the executable bit, for CLIs that tasks find on PATH. */
  executable?: boolean;
}

export interface GeneratedProject {
  meta: ProjectMeta;
  files: ProjectFile[];
}

export interface GenerateOptions {
  registry?: string;
  /** Where script CLIs go; see `ScriptLayout`. Defaults to the module's own `resources/usr/bin`. */
  scriptLayout?: ScriptLayout;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

export function defaultProjectSettings(doc: Pick<WorkflowDoc, "name">): ProjectSettings {
  return { name: `studio/${slugify(doc.name) || "pipeline"}`, version: "1.0.0dev", author: "Nextflow Studio" };
}

export function projectMeta(doc: Pick<WorkflowDoc, "name" | "description" | "project">): ProjectMeta {
  const settings = doc.project ?? defaultProjectSettings(doc);
  const slug = slugify(settings.name.split("/").pop() ?? "") || "pipeline";
  // Becomes a Nextflow workflow identifier, which can't start with a digit.
  const shortName = /^\d/.test(slug) ? `nf${slug}` : slug;
  return {
    name: settings.name.includes("/") ? settings.name : `studio/${settings.name}`,
    shortName,
    workflowName: shortName.toUpperCase(),
    description: (doc.description || doc.name).replaceAll('"', "'"),
    author: settings.author.replaceAll("'", ""),
    version: settings.version,
  };
}

const VERSION_SAVE = "filename -> filename.equals('versions.yml') ? null : filename";

function directiveClosure(body: string): string {
  const trimmed = body.trim();
  return trimmed.startsWith("{") ? trimmed : `{ ${trimmed} }`;
}

function ruleBody(rule: PublishDir): string[] {
  const path = `"${rule.path.trim().replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const lines = [`    path: { ${path} },`, "    mode: params.publish_dir_mode,"];
  if (rule.pattern?.trim()) lines.push(`    pattern: ${gstr(rule.pattern.trim())},`);
  lines.push(`    saveAs: { ${rule.saveAs?.trim() || VERSION_SAVE} }`);
  return lines;
}

function publishLines(alias: string, config: NodeConfig): string[] {
  if (config.publish === false) return ["publishDir = [ enabled: false ]"];
  const primary: PublishDir[] =
    config.publishPath?.trim() || config.publishPattern?.trim() || config.publishSaveAs?.trim()
      ? [
          {
            path: config.publishPath?.trim() || `\${params.outdir}/${alias.toLowerCase()}`,
            pattern: config.publishPattern?.trim() || undefined,
            saveAs: config.publishSaveAs?.trim() || undefined,
          },
        ]
      : [];
  const rules = [...primary, ...(config.publishDirs ?? [])];
  if (!rules.length) {
    return [
      "publishDir = [",
      `    path: { "\${params.outdir}/${alias.toLowerCase()}" },`,
      "    mode: params.publish_dir_mode,",
      `    saveAs: { ${VERSION_SAVE} }`,
      "]",
    ];
  }
  if (rules.length === 1) return ["publishDir = [", ...ruleBody(rules[0]), "]"];
  const lines = ["publishDir = ["];
  rules.forEach((rule, index) => {
    lines.push("    [");
    lines.push(...ruleBody(rule).map((line) => `    ${line}`));
    lines.push(index === rules.length - 1 ? "    ]" : "    ],");
  });
  lines.push("]");
  return lines;
}

function modulesConfig(doc: WorkflowDoc, index: ModuleIndex, meta: ProjectMeta): string {
  const { order } = planNodes(doc, index);
  const blocks = order
    .filter((p) => !p.def.builtin || p.def.temporary)
    .map(({ node, def }) => {
      const { config, alias } = { config: node.data.config, alias: node.data.alias };
      const lines: string[] = [];
      if (config.args?.trim()) {
        lines.push(`ext.args   = ${gdynamic(config.args.trim())}`);
      }
      if (config.prefix?.trim()) lines.push(`ext.prefix = ${gdynamic(config.prefix.trim())}`);
      if (config.label && config.label !== def.label) {
        lines.push(`// Resources of ${config.label} (module default: ${def.label ?? "none"})`);
        lines.push(...(LABEL_RESOURCES[config.label] ?? []));
      }
      if (config.errorStrategy?.trim()) lines.push(`errorStrategy = ${gstr(config.errorStrategy.trim())}`);
      if (config.when?.trim()) lines.push(`when = { ${config.when.trim()} }`);
      else if (config.whenEmpty) lines.push("when = { x == 'EMPTY' }");
      if (config.memory?.trim()) lines.push(`memory = ${directiveClosure(config.memory)}`);
      if (config.cpus?.trim()) lines.push(`cpus = ${directiveClosure(config.cpus)}`);
      lines.push(...publishLines(alias, config));
      return `    withName: '${alias}' {\n${lines.map((l) => `        ${l}`).join("\n")}\n    }`;
    });

  return `${section(`${meta.name}: per-module options and publishing paths`)}
/*
    Generated from the canvas. Available keys to override module options:
        ext.args   = Additional arguments appended to command in module.
        ext.prefix = File name prefix for output files.
*/

process {

    publishDir = [
        path: { "\${params.outdir}/\${task.process.tokenize(':')[-1].tokenize('_')[0].toLowerCase()}" },
        mode: params.publish_dir_mode,
        saveAs: { filename -> filename.equals('versions.yml') ? null : filename }
    ]

${blocks.join("\n\n")}
}
`;
}

function readme(meta: ProjectMeta, doc: WorkflowDoc, index: ModuleIndex) {
  const { order } = planNodes(doc, index);
  const steps = order
    .filter((p) => !p.def.builtin)
    .map((p, i) => `${i + 1}. \`${p.node.data.alias}\`: ${p.def.description.split("\n")[0]}`);
  const input = usesSamplesheet(doc) ? " \\\n   --input samplesheet.csv" : "";
  const refs = referenceParams(doc).map((r) => ` \\\n   --${r.name} <${r.format.toUpperCase()}>`).join("");
  return `# ${meta.name}

${meta.description}

Generated by Nextflow Studio. Local modules live in \`modules/local/\`; each one declares its
conda environment and/or container, and \`-profile\` picks which one is used.

## Steps

${steps.join("\n") || "(builtin nodes only)"}

## Usage

\`\`\`bash
nextflow run . \\
   -profile <conda/docker/apptainer/...>${input}${refs} \\
   --outdir <OUTDIR>
\`\`\`

Without \`-profile\`, tasks run in the plain shell with the tools already on PATH.
`;
}

/** Module CLIs in `resources/usr/bin` reach PATH only with this flag. */
function withModuleBinaries(config: string, scripts: readonly ProjectFile[], layout: ScriptLayout): string {
  if (layout !== "module" || !scripts.some((file) => file.executable)) return config;
  return `${config.trimEnd()}\n\n// Put each module's resources/usr/bin on PATH and mount it in containers\nnextflow.enable.moduleBinaries = true\n`;
}

export function generateProject(doc: WorkflowDoc, index: ModuleIndex, opts: GenerateOptions = {}): GeneratedProject {
  const refs = referenceParams(doc);
  const { order } = planNodes(doc, index);
  const meta = projectMeta(doc);
  const samplesheet = usesSamplesheet(doc);
  const schema = buildParamsSchema(meta.name, meta.description, refs, patternParams(doc), { input: samplesheet });

  const layout = opts.scriptLayout ?? "module";
  const scripts = scriptProjectFiles(order, layout);
  const files: ProjectFile[] = [
    { path: "main.nf", language: "groovy", content: generateMainScript(doc, index, { name: meta.name, description: meta.description }) },
    { path: "nextflow.config", language: "groovy", content: withModuleBinaries(nextflowConfig(meta, paramsBlock(schema), opts.registry ?? "quay.io"), scripts, layout) },
    { path: "conf/base.config", language: "groovy", content: baseConfig(meta) },
    { path: "conf/modules.config", language: "groovy", content: modulesConfig(doc, index, meta) },
    { path: "nextflow_schema.json", language: "json", content: `${JSON.stringify(schema, null, 4)}\n` },
    ...(samplesheet
      ? [
          {
            path: "assets/schema_input.json",
            language: "json" as const,
            content: `${JSON.stringify(
              {
                ...samplesheetSchema,
                $id: `https://raw.githubusercontent.com/${meta.name}/main/assets/schema_input.json`,
                title: `${meta.name} pipeline - params.input schema`,
              },
              null,
              4,
            )}\n`,
          },
          { path: "assets/samplesheet.csv", language: "csv" as const, content: SAMPLESHEET_CSV },
        ]
      : []),
    { path: "README.md", language: "markdown", content: readme(meta, doc, index) },
    ...scripts,
  ];

  return { meta, files };
}
