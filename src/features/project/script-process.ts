import { gstr, nf } from "./groovy";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { moduleOrigin } from "@/features/workflow/origin";

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

/** `conda` / `container` lines for a published script. Blank fields are omitted. */
export function scriptEnvDirectives(env: { condaYaml?: string; containerImage?: string }): string[] {
  const lines: string[] = [];
  const conda = env.condaYaml?.trim();
  const image = env.containerImage?.trim();
  if (conda) lines.push(`conda ${gstr(conda)}`);
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
  const flags = def.inputs.map(cliFlag).join(" \\\\\n        ");
  const directives = scriptEnvDirectives(def);
  const directiveBlock = directives.length ? `${directives.join("\n    ")}\n    ` : "";
  return nf`process ${def.process} {
    ${directiveBlock}${inputs.length ? `input:\n    ${inputs.join("\n    ")}` : ""}
    ${outputs.length ? `output:\n    ${outputs.join("\n    ")}` : ""}
    script:
    ${prep.join("\n    ")}
    """
    ${interpreter} "@{workflow.projectDir}/${def.command ?? "bin/main.py"}" \\
        ${flags}
        @{task.ext.args ?: ''}
    """
}`;
}

export function scriptProjectFiles(order: { def: ModuleDef }[]): { path: string; content: string; language: "groovy" | "text" }[] {
  const files: { path: string; content: string; language: "groovy" | "text" }[] = [];
  const seen = new Set<string>();
  for (const { def } of order) {
    if (moduleOrigin(def) !== "script" || seen.has(def.id) || !def.script || !def.command || !def.path) continue;
    seen.add(def.id);
    files.push({ path: `modules/local/${def.path}/main.nf`, language: "groovy", content: `${scriptProcessSource(def)}\n` });
    files.push({ path: def.command, language: "text", content: def.script });
  }
  return files;
}
