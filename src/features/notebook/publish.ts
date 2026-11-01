import { inputPorts, outputPorts, convertNotebook, moduleSlug } from "./convert";
import { cleanEnvField } from "./env";
import type { NotebookDoc, TryRunRecord } from "./types";
import type { ModuleDef } from "@/features/workflow/types";
import { versionNumber } from "@/features/workflow/origin";

export function nextModuleVersion(existing: readonly ModuleDef[], notebookId: string): string {
  const numbers = existing
    .filter((mod) => mod.sourceNotebookId === notebookId)
    .map((mod) => versionNumber(mod.version));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `v${next}`;
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
  const version = nextModuleVersion(input.existing, input.notebook.id);
  const slug = moduleSlug(name);
  const folder = `${slug}_${version}`;
  const ext = converted.language === "r" ? "R" : "py";
  return {
    id: `script/${input.notebook.id}/${version}`,
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
    sourceNotebookId: input.notebook.id,
    sourceNotebookRev: input.notebook.rev,
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
