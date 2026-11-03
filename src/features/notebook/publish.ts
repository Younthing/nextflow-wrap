import { inputPorts, outputPorts, convertNotebook, moduleSlug } from "./convert";
import { cleanEnvField, sameModuleEnv } from "./env";
import { buildLibraryCopy, type ModuleLibraryCopy } from "./library-copy";
import type { NotebookDoc, TryRunRecord } from "./types";
import type { ModuleDef } from "@/features/workflow/types";
import { versionNumber } from "@/features/workflow/origin";

/**
 * Where an export goes: a new module (`script/<slug>`, from the name), or an existing one it overwrites in place.
 * Overwriting keeps the id, so workflows that use the module run the new version; the version label goes up.
 */
export function exportTarget(name: string, existing: readonly ModuleDef[], overwrite?: string): { id: string; slug: string; version: string } {
  if (overwrite) {
    const current = existing.find((mod) => mod.id === overwrite && mod.id.startsWith("script/"));
    if (!current) throw new Error("要覆盖的模块不存在");
    return { id: current.id, slug: current.id.slice("script/".length), version: `v${versionNumber(current.version) + 1}` };
  }
  const slug = moduleSlug(name);
  const id = `script/${slug}`;
  const taken = existing.find((mod) => mod.id === id);
  if (taken) throw new Error(`已有模块「${taken.name}」，选择覆盖它或换个名字`);
  return { id, slug, version: "v1" };
}

export function processName(name: string): string {
  const base = name.replace(/\.py$/i, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  const ident = /^[A-Z]/.test(base) ? base : `M_${base || "NOTEBOOK"}`;
  return ident.slice(0, 80);
}

export function buildScriptModule(input: {
  notebook: NotebookDoc;
  name: string;
  description: string;
  changelog?: string;
  condaYaml?: string;
  containerImage?: string;
  existing: readonly ModuleDef[];
  /** Module id to overwrite; a new module when unset. */
  overwrite?: string;
  receipt: TryRunRecord | undefined;
}): ModuleDef {
  const name = input.name.trim();
  if (!/^[A-Za-z_][\w.-]{0,80}$/.test(name)) throw new Error("模块名需要以字母或下划线开头");
  const converted = convertNotebook(input.notebook);
  if (!converted.outputs.length) throw new Error("至少标一个输出端口才能发布");
  if (!input.receipt || input.receipt.notebookId !== input.notebook.id || input.receipt.rev !== input.notebook.rev || !input.receipt.passed) {
    throw new Error("试跑通过后才能保存");
  }
  const condaYaml = cleanEnvField(input.condaYaml, "Conda yaml 路径");
  const containerImage = cleanEnvField(input.containerImage, "容器地址");
  if (!sameModuleEnv(input.receipt, { condaYaml, containerImage })) {
    throw new Error("试跑用的 conda／容器与将保存的不一致，请按当前环境重新试跑");
  }
  const { id, slug, version } = exportTarget(name, input.existing, input.overwrite);
  const folder = `${slug}_${version}`;
  const ext = converted.language === "r" ? "R" : "py";
  return {
    id,
    path: folder,
    name,
    process: processName(name),
    category: "自定义",
    description: input.description.trim() || input.notebook.description || "从笔记本发布的脚本模块",
    keywords: ["notebook", "script", slug],
    tools: [],
    origin: "script",
    inputs: inputPorts(converted.inputs),
    outputs: outputPorts(converted.outputs),
    version,
    tryRun: "passed",
    command: `bin/${folder}.${ext}`,
    script: convertNotebook(input.notebook, `bin/${folder}.${ext}`).script,
    kernel: input.notebook.kernel,
    condaYaml,
    containerImage,
    changelog: input.changelog?.trim() || undefined,
    label: "process_low",
  };
}

/** Convert, require a passing try-run, and pair the CLI with a jupytext library copy. */
export function publishScriptModule(input: {
  notebook: NotebookDoc;
  name: string;
  description: string;
  changelog?: string;
  condaYaml?: string;
  containerImage?: string;
  existing: readonly ModuleDef[];
  overwrite?: string;
  receipt: TryRunRecord | undefined;
  savedAt?: string;
}): { module: ModuleDef; library: ModuleLibraryCopy } {
  const moduleDef = buildScriptModule(input);
  const library = buildLibraryCopy({ notebook: input.notebook, module: moduleDef, savedAt: input.savedAt });
  return { module: moduleDef, library };
}
