import samplesheetSchema from "@/data/samplesheet-schema.json";
import emailTemplates from "./email-templates.json";
import type { ModuleIndex } from "@/features/workflow/catalog";
import type { ProjectSettings, WorkflowDoc } from "@/features/workflow/types";
import { gdynamic, gstr, section } from "./groovy";
import { buildParamsSchema, paramsBlock, referenceParams } from "./schema";
import {
  LABEL_RESOURCES,
  METHODS_DESCRIPTION,
  MULTIQC_CONFIG,
  SAMPLESHEET_CSV,
  baseConfig,
  mainNf,
  nextflowConfig,
  testConfig,
  utilsSubworkflow,
  type ProjectMeta,
} from "./templates";
import { GenerateError, MULTIQC_ID, generateWorkflowScript, planNodes } from "./workflow-script";

export { GenerateError };

export interface ProjectFile {
  path: string;
  content: string;
  language: "groovy" | "json" | "yaml" | "csv" | "markdown" | "text";
}

/** A file the run backend installs with `nf-core modules install`. */
export interface RemoteComponent {
  kind: "module" | "subworkflow";
  path: string;
  gitSha: string;
}

export interface GeneratedProject {
  meta: ProjectMeta;
  files: ProjectFile[];
  components: RemoteComponent[];
}

export interface GenerateOptions {
  /** nf-core/modules commit to pin modules.json to. */
  modulesSha: string;
  registry?: string;
}

const UTILS_SUBWORKFLOWS = ["utils_nextflow_pipeline", "utils_nfcore_pipeline", "utils_nfschema_plugin"];

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

function modulesConfig(doc: WorkflowDoc, index: ModuleIndex, meta: ProjectMeta): string {
  const { order } = planNodes(doc, index);
  const blocks = order
    .filter((p) => !p.def.builtin)
    .map(({ node, def }) => {
      const { config, alias } = { config: node.data.config, alias: node.data.alias };
      const lines: string[] = [];
      if (def.id === MULTIQC_ID) {
        const extra = config.args?.trim() ? ` + ' ' + ${gstr(config.args.trim())}` : "";
        lines.push(`ext.args   = { (params.multiqc_title ? "--title \\"$params.multiqc_title\\"" : '')${extra} }`);
      } else if (config.args?.trim()) {
        lines.push(`ext.args   = ${gdynamic(config.args.trim())}`);
      }
      if (config.prefix?.trim()) lines.push(`ext.prefix = ${gdynamic(config.prefix.trim())}`);
      if (config.label && config.label !== def.label) {
        lines.push(`// Resources of ${config.label} (module default: ${def.label ?? "none"})`);
        lines.push(...(LABEL_RESOURCES[config.label] ?? []));
      }
      if (config.publish === false) {
        lines.push("publishDir = [ enabled: false ]");
      } else {
        lines.push(
          "publishDir = [",
          `    path: { "\${params.outdir}/${alias.toLowerCase()}" },`,
          "    mode: params.publish_dir_mode,",
          "    saveAs: { filename -> filename.equals('versions.yml') ? null : filename }",
          "]",
        );
      }
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

function citations(doc: WorkflowDoc, index: ModuleIndex) {
  const { order } = planNodes(doc, index);
  const seen = new Set<string>();
  const out: { inText: string; bibliography: string }[] = [];
  for (const { def } of order) {
    for (const tool of def.tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      const doi = tool.doi ? ` doi: ${tool.doi}` : "";
      out.push({
        inText: tool.name.replaceAll('"', ""),
        bibliography: `${tool.name}${tool.homepage ? `, ${tool.homepage}` : ""}.${doi}`.replaceAll('"', "'"),
      });
    }
  }
  return out;
}

function modulesJson(meta: ProjectMeta, components: RemoteComponent[]) {
  const entries = (kind: RemoteComponent["kind"]) =>
    Object.fromEntries(
      components
        .filter((c) => c.kind === kind)
        .map((c) => [c.path, { branch: "master", git_sha: c.gitSha, installed_by: [kind === "module" ? "modules" : "subworkflows"] }]),
    );
  return {
    name: meta.name,
    homePage: `https://github.com/${meta.name}`,
    repos: {
      "https://github.com/nf-core/modules.git": {
        modules: { "nf-core": entries("module") },
        subworkflows: { "nf-core": entries("subworkflow") },
      },
    },
  };
}

function readme(meta: ProjectMeta, doc: WorkflowDoc, index: ModuleIndex) {
  const { order } = planNodes(doc, index);
  const steps = order
    .filter((p) => !p.def.builtin)
    .map((p, i) => `${i + 1}. \`${p.node.data.alias}\`: ${p.def.description.split("\n")[0]}`);
  const refs = referenceParams(doc).map((r) => ` \\\n   --${r.name} <${r.format.toUpperCase()}>`).join("");
  return `# ${meta.name}

${meta.description}

This pipeline was generated by Nextflow Studio and follows the nf-core template layout.

## Steps

${steps.join("\n")}

## Usage

Prepare a samplesheet (\`assets/samplesheet.csv\` shows the format), then run:

\`\`\`bash
nextflow run . \\
   -profile <docker/singularity/.../institute> \\
   --input samplesheet.csv${refs} \\
   --outdir <OUTDIR>
\`\`\`

Modules come from [nf-core/modules](https://github.com/nf-core/modules) and are listed in \`modules.json\`.
Install them before the first run with \`nf-core modules install\` (Nextflow Studio does this for you).
`;
}

export function generateProject(doc: WorkflowDoc, index: ModuleIndex, opts: GenerateOptions): GeneratedProject {
  const refs = referenceParams(doc);
  const { order } = planNodes(doc, index);
  const meta = projectMeta(doc);
  // Included processes and the pipeline workflow share one namespace.
  if (order.some((p) => p.node.data.alias === meta.workflowName)) meta.workflowName += "_PIPELINE";
  const schema = buildParamsSchema(meta.name, meta.description, refs);

  const moduleComponents = [...new Map(order.filter((p) => !p.def.builtin).map((p) => [p.def.path, p.def])).values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((def) => ({ kind: "module" as const, path: def.path, gitSha: opts.modulesSha }));
  if (!moduleComponents.some((c) => c.path === "multiqc") && order.some((p) => p.def.id === MULTIQC_ID)) {
    throw new GenerateError("MultiQC 模块缺失");
  }
  const components: RemoteComponent[] = [
    ...moduleComponents,
    ...UTILS_SUBWORKFLOWS.map((path) => ({ kind: "subworkflow" as const, path, gitSha: opts.modulesSha })),
  ];

  const files: ProjectFile[] = [
    { path: "main.nf", language: "groovy", content: mainNf(meta, refs.map((r) => r.name)) },
    {
      path: `workflows/${meta.shortName}.nf`,
      language: "groovy",
      content: generateWorkflowScript(doc, index, { shortName: meta.shortName, workflowName: meta.workflowName }),
    },
    {
      path: `subworkflows/local/utils_nfcore_${meta.shortName}_pipeline/main.nf`,
      language: "groovy",
      content: utilsSubworkflow(meta, citations(doc, index)),
    },
    { path: "nextflow.config", language: "groovy", content: nextflowConfig(meta, paramsBlock(schema), opts.registry ?? "quay.io") },
    { path: "conf/base.config", language: "groovy", content: baseConfig(meta) },
    { path: "conf/modules.config", language: "groovy", content: modulesConfig(doc, index, meta) },
    { path: "conf/test.config", language: "groovy", content: testConfig(meta) },
    { path: "nextflow_schema.json", language: "json", content: `${JSON.stringify(schema, null, 4)}\n` },
    {
      path: "assets/schema_input.json",
      language: "json",
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
    { path: "assets/samplesheet.csv", language: "csv", content: SAMPLESHEET_CSV },
    { path: "assets/multiqc_config.yml", language: "yaml", content: MULTIQC_CONFIG(meta) },
    { path: "assets/methods_description_template.yml", language: "yaml", content: METHODS_DESCRIPTION(meta) },
    // Read by completionEmail() when --email or --email_on_fail is set.
    ...Object.entries(emailTemplates).map(([file, content]) => ({
      path: `assets/${file}`,
      language: "text" as const,
      content: content.replaceAll("__NAME__", meta.name).replaceAll("__DESCRIPTION__", meta.description),
    })),
    { path: "modules.json", language: "json", content: `${JSON.stringify(modulesJson(meta, components), null, 4)}\n` },
    {
      path: ".nf-core.yml",
      language: "yaml",
      content: `repository_type: pipeline
nf_core_version: 3.5.0
template:
  author: ${meta.author}
  description: ${meta.description}
  name: ${meta.shortName}
  org: ${meta.name.split("/")[0]}
  outdir: .
  version: ${meta.version}
  is_nfcore: false
`,
    },
    { path: "README.md", language: "markdown", content: readme(meta, doc, index) },
  ];

  return { meta, files, components };
}
