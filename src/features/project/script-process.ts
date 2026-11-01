import { gstr, nf } from "./groovy";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { moduleOrigin } from "@/features/workflow/origin";

/**
 * Where a script module's CLI lives in a generated project.
 * - `module`: inside the module, `resources/usr/bin/`, put on PATH by `nextflow.enable.moduleBinaries`.
 *   The module directory is self-contained, as in the module library.
 * - `bin`: the project's `bin/`, for executors whose remote nodes cannot see module binaries
 *   without Wave (cloud batch services and Kubernetes).
 */
export type ScriptLayout = "module" | "bin";

export interface ModuleFile {
  path: string;
  content: string;
  language: "groovy" | "yaml" | "text";
  executable?: boolean;
}

/** Library namespace used until modules carry their own. Matches nf-core's `modules/local`. */
export const DEFAULT_NAMESPACE = "local";

export const moduleNamespace = (def: Pick<ModuleDef, "namespace">) => def.namespace || DEFAULT_NAMESPACE;

/** File name of the module's CLI, for example `qc_summary_v2.py`. */
export function scriptFileName(def: Pick<ModuleDef, "command" | "path">): string {
  return (def.command ?? `bin/${def.path}.py`).split("/").pop()!;
}

/** Library folder name without the version suffix, for example `qc_summary` for `qc_summary_v2`. */
export function moduleSlugOf(def: Pick<ModuleDef, "path" | "version">): string {
  const suffix = def.version ? `_${def.version}` : "";
  return suffix && def.path.endsWith(suffix) ? def.path.slice(0, -suffix.length) : def.path;
}

function inputLine(port: PortDef): string {
  return port.widget ? `val ${port.name}` : `path ${port.name}`;
}

function outputLine(port: PortDef): string {
  const pattern = port.elements.find((el) => el.kind === "file")?.description;
  const filename = pattern && !pattern.includes(" ") ? pattern : `${port.name}.txt`;
  return `path '${filename.replaceAll("'", "")}', emit: ${port.name}`;
}

function cliFlag(port: PortDef): string {
  if (port.widget) return `--${port.name} '@{${port.name}}'`;
  return `--${port.name} @{${port.name}_cli}`;
}

/**
 * `conda` / `container` lines for a published script. Blank fields are omitted.
 * A module that carries its environment file points at its own copy, so the module directory is portable.
 */
export function scriptEnvDirectives(env: { condaYaml?: string; containerImage?: string; environmentYml?: string }): string[] {
  const lines: string[] = [];
  const conda = env.condaYaml?.trim();
  const image = env.containerImage?.trim();
  if (env.environmentYml?.trim()) lines.push('conda "@{moduleDir}/environment.yml"');
  else if (conda) lines.push(`conda ${gstr(conda)}`);
  if (image) lines.push(`container ${gstr(image)}`);
  return lines;
}

/** Local Nextflow process plus the generated CLI. Users never edit this by hand. */
export function scriptProcessSource(def: ModuleDef): string {
  const inputs = def.inputs.map(inputLine);
  const outputs = def.outputs.map(outputLine);
  const prep = def.inputs
    .filter((port) => !port.widget)
    .map((port) => `def ${port.name}_cli = ${port.name} instanceof List ? ${port.name}.join(' ') : ${port.name}`);
  const interpreter = def.command?.endsWith(".R") ? "Rscript" : "python3";
  // `task.ext.args` continues the same command line; on its own line the shell would run it as a command.
  const args = [...def.inputs.map(cliFlag), "@{task.ext.args ?: ''}"].join(" \\\\\n        ");
  const directives = scriptEnvDirectives(def);
  const directiveBlock = directives.length ? `${directives.join("\n    ")}\n    ` : "";
  // The CLI is found on PATH, from the module's resources/usr/bin or the project's bin/; both are mounted
  // into containers. Calling it through the interpreter keeps working when the shebang names another one.
  return nf`process ${def.process} {
    ${directiveBlock}${inputs.length ? `input:\n    ${inputs.join("\n    ")}` : ""}
    ${outputs.length ? `output:\n    ${outputs.join("\n    ")}` : ""}
    script:
    ${prep.join("\n    ")}
    """
    ${interpreter} "\\$(command -v ${scriptFileName(def)})" \\
        ${args}
    """
}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function portYaml(port: PortDef): string[] {
  const kind = port.widget ? "val" : "path";
  const lines = [`  - name: ${port.name}`, `    type: ${kind}`];
  const description = port.description?.trim();
  if (description) lines.push(`    description: ${yamlString(description)}`);
  const pattern = port.elements.find((el) => el.kind === "file")?.description;
  if (!port.widget && pattern) lines.push(`    pattern: ${yamlString(pattern)}`);
  return lines;
}

/** `meta.yml`: what the module is, its ports and where it came from. Read by people and by the library index. */
export function scriptMetaYaml(def: ModuleDef): string {
  const lines = [
    `name: ${yamlString(moduleSlugOf(def))}`,
    `namespace: ${yamlString(moduleNamespace(def))}`,
    `version: ${yamlString(def.version ?? "")}`,
    `process: ${def.process}`,
    `description: ${yamlString(def.description)}`,
    `keywords: [${def.keywords.map(yamlString).join(", ")}]`,
    `script: ${yamlString(scriptFileName(def))}`,
    "input:",
    ...(def.inputs.length ? def.inputs.flatMap(portYaml) : ["  []"]),
    "output:",
    ...(def.outputs.length ? def.outputs.flatMap(portYaml) : ["  []"]),
  ];
  if (def.sourceNotebookId) {
    lines.push("source:", `  notebook: ${yamlString(def.sourceNotebookId)}`);
    if (def.sourceNotebookRev !== undefined) lines.push(`  revision: ${def.sourceNotebookRev}`);
  }
  if (def.changelog) lines.push(`changelog: ${yamlString(def.changelog)}`);
  return `${lines.join("\n")}\n`;
}

/** The files of one script module, relative to its module directory, plus its CLI. */
export function scriptModuleFiles(def: ModuleDef): ModuleFile[] {
  const files: ModuleFile[] = [
    { path: "main.nf", language: "groovy", content: `${scriptProcessSource(def)}\n` },
    { path: "meta.yml", language: "yaml", content: scriptMetaYaml(def) },
  ];
  const environment = def.environmentYml?.trim();
  if (environment) files.push({ path: "environment.yml", language: "yaml", content: `${environment}\n` });
  files.push({ path: `resources/usr/bin/${scriptFileName(def)}`, language: "text", content: def.script ?? "", executable: true });
  return files;
}

export function scriptProjectFiles(order: { def: ModuleDef }[], layout: ScriptLayout = "module"): ModuleFile[] {
  const files: ModuleFile[] = [];
  const seen = new Set<string>();
  for (const { def } of order) {
    if (moduleOrigin(def) !== "script" || seen.has(def.id) || !def.script || !def.command || !def.path) continue;
    seen.add(def.id);
    const root = `modules/${moduleNamespace(def)}/${def.path}`;
    for (const file of scriptModuleFiles(def)) {
      if (file.path.startsWith("resources/usr/bin/") && layout === "bin") {
        files.push({ ...file, path: `bin/${scriptFileName(def)}` });
      } else {
        files.push({ ...file, path: `${root}/${file.path}` });
      }
    }
  }
  return files;
}
