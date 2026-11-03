import { scriptModuleFiles, type ModuleFile } from "@/features/project/script-process";
import { ConvertError, inputPorts, moduleSlug, outputPorts } from "./convert";
import { isFileInput, isListInput } from "./input-bindings";
import { processName } from "./publish";
import type { ConvertedNotebook, MarkerInput, NotebookDoc } from "./types";
import type { TryRunSelection } from "./try-run-env";
import type { ModuleDef } from "@/features/workflow/types";

/** Namespace of the draft module a try-run tests, the same one published modules live in. */
export const TRY_RUN_NAMESPACE = "local";

/**
 * The module a publish would write, built from the converted notebook so the try-run tests the same
 * `main.nf` and CLI. The name is a placeholder; ports, script and environment are what matter.
 */
export function draftModuleDef(
  notebook: NotebookDoc,
  converted: ConvertedNotebook,
  env: { condaYaml?: string; containerImage?: string },
): ModuleDef {
  const slug = moduleSlug(notebook.name).toLowerCase();
  return {
    id: `script/${slug}`,
    path: slug,
    name: slug,
    process: processName(notebook.name),
    category: "自定义",
    description: notebook.description || "试跑草稿",
    keywords: [],
    tools: [],
    origin: "script",
    inputs: inputPorts(converted.inputs),
    outputs: outputPorts(converted.outputs),
    command: converted.entry,
    script: converted.script,
    ...(env.condaYaml ? { condaYaml: env.condaYaml } : {}),
    ...(env.containerImage ? { containerImage: env.containerImage } : {}),
  };
}

/** Files of the draft module, relative to the try-run directory: `modules/local/<slug>/…`. */
export function draftModuleFiles(def: ModuleDef): ModuleFile[] {
  return scriptModuleFiles(def).map((file) => ({ ...file, path: `modules/${TRY_RUN_NAMESPACE}/${def.path}/${file.path}` }));
}

/** `nextflow.config` for the try-run: module binaries on PATH, plus the conda or container engine picked. */
export function tryRunNextflowConfig(selection: TryRunSelection): string {
  const lines = ["// Put the module's resources/usr/bin on PATH and mount it in containers", "nextflow.enable.moduleBinaries = true"];
  if (selection.via === "conda") {
    lines.push("conda.enabled = true");
    if (selection.tool.kind === "micromamba") lines.push("conda.useMicromamba = true");
    if (selection.tool.kind === "mamba") lines.push("conda.useMamba = true");
  }
  if (selection.via === "container") {
    const kind = selection.tool.kind;
    lines.push(`${kind}.enabled = true`);
    if (kind === "singularity" || kind === "apptainer") lines.push(`${kind}.autoMounts = true`);
  }
  return `${lines.join("\n")}\n`;
}

const isBool = (input: MarkerInput) => input.type === "bool" || input.type === "boolean";

/**
 * Pipeline parameters for `nextflow module run`: one `--<port> <value>` per input.
 * Staged file names live in `inputsDir` (relative to the run directory); absolute paths pass through.
 * File lists are comma-separated, which Nextflow expands to a list of paths.
 */
export function moduleRunParams(inputs: MarkerInput[], values: Record<string, string>, inputsDir: string): string[] {
  const args: string[] = [];
  for (const input of inputs) {
    const raw = values[input.name]?.trim() ?? "";
    if (isBool(input)) {
      const on = raw ? raw === "true" || raw === "1" : input.defaultValue === "true";
      args.push(`--${input.name}`, on ? "true" : "false");
      continue;
    }
    const value = raw || input.defaultValue || "";
    if (!value) {
      if (input.required) throw new ConvertError(`缺少参数 ${input.name}`);
      args.push(`--${input.name}`, "");
      continue;
    }
    if (!isFileInput(input)) {
      args.push(`--${input.name}`, value);
      continue;
    }
    const tokens = isListInput(input) ? value.split(/[\s,]+/).filter(Boolean) : [value];
    const paths = tokens.map((token) => (token.startsWith("/") ? token : `${inputsDir}/${token}`));
    args.push(`--${input.name}`, paths.join(","));
  }
  return args;
}

/** Output paths printed by `nextflow module run -output-format json`, keyed by output port. */
export function parseModuleOutputs(stdout: string): Record<string, string[]> {
  const start = stdout.lastIndexOf("\n{");
  const text = start >= 0 ? stdout.slice(start + 1) : stdout.trimStart().startsWith("{") ? stdout.trimStart() : "";
  const end = text.lastIndexOf("}");
  if (!text || end < 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(0, end + 1));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const outputs: Record<string, string[]> = {};
  const flatten = (value: unknown): string[] =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(flatten) : [];
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) outputs[name] = flatten(value);
  return outputs;
}
