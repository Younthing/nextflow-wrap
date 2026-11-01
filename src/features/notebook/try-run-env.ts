import { scriptEnvDirectives } from "@/features/project/script-process";
import { gstr } from "@/features/project/groovy";
import { scriptInterpreter, tryRunCommand } from "./convert";
import type { NotebookLanguage } from "./types";

export type TryRunVia = "host" | "conda" | "container";

export type ContainerKind = "docker" | "podman" | "singularity" | "apptainer";
export type CondaKind = "micromamba" | "mamba" | "conda";

export interface ContainerTool {
  bin: string;
  kind: ContainerKind;
}

export interface CondaTool {
  bin: string;
  kind: CondaKind;
}

export interface TryRunTools {
  conda?: CondaTool;
  container?: ContainerTool;
}

export type TryRunSelection =
  | { via: "host" }
  | { via: "conda"; tool: CondaTool; note?: string }
  | { via: "container"; tool: ContainerTool; note?: string }
  | { via: "unavailable"; message: string };

const CONTAINER_TOOLS = "docker、podman、singularity、apptainer";
const CONDA_TOOLS = "micromamba、mamba、conda";

/**
 * Pick the engine for a publish try-run.
 * A filled container wins when a runtime exists, matching a docker-enabled Nextflow
 * process. Otherwise a filled conda yaml is used. The host interpreter is only
 * for a module that left both fields blank.
 */
export function selectTryRunEngine(
  env: { condaYaml?: string; containerImage?: string },
  tools: TryRunTools,
): TryRunSelection {
  const conda = env.condaYaml;
  const image = env.containerImage;
  if (!conda && !image) return { via: "host" };
  if (image && tools.container) {
    return {
      via: "container",
      tool: tools.container,
      note: conda ? "conda 与 container 都已填写。本机有容器运行时，试跑选用容器。" : undefined,
    };
  }
  if (conda && tools.conda) {
    return {
      via: "conda",
      tool: tools.conda,
      note: image ? `未找到容器运行时，不能启动 container ${gstr(image)}，改用 conda。` : undefined,
    };
  }
  if (image && conda) {
    return {
      via: "unavailable",
      message: `未找到容器运行时（${CONTAINER_TOOLS}）和 conda（${CONDA_TOOLS}），不能按 container ${gstr(image)} 或 conda ${gstr(conda)} 试跑。`,
    };
  }
  if (image) {
    return {
      via: "unavailable",
      message: `未找到容器运行时（${CONTAINER_TOOLS}），不能按 container ${gstr(image)} 试跑。`,
    };
  }
  return {
    via: "unavailable",
    message: `未找到 conda（${CONDA_TOOLS}），不能按 conda ${gstr(conda ?? "")} 试跑。`,
  };
}

export function containerCommand(
  tool: ContainerTool,
  dir: string,
  image: string,
  command: string[],
): { executable: string; args: string[] } {
  if (tool.kind === "singularity" || tool.kind === "apptainer") {
    const target = image.includes("://") || image.endsWith(".sif") ? image : `docker://${image}`;
    return {
      executable: tool.bin,
      args: ["exec", "--bind", `${dir}:${dir}`, "--pwd", dir, target, ...command],
    };
  }
  return {
    executable: tool.bin,
    args: ["run", "--rm", "-v", `${dir}:${dir}`, "-w", dir, image, ...command],
  };
}

export function condaCreateCommand(
  tool: CondaTool,
  prefix: string,
  yamlPath: string,
): { executable: string; args: string[] } {
  const args = tool.kind === "micromamba"
    ? ["create", "-y", "-p", prefix, "-f", yamlPath]
    : ["env", "create", "-y", "-p", prefix, "-f", yamlPath];
  return { executable: tool.bin, args };
}

export function condaRunCommand(
  tool: CondaTool,
  prefix: string,
  command: string[],
): { executable: string; args: string[] } {
  const args = tool.kind === "micromamba"
    ? ["run", "-p", prefix, ...command]
    : ["run", "-p", prefix, "--no-capture-output", ...command];
  return { executable: tool.bin, args };
}

function quoteArg(arg: string): string {
  if (arg === "") return "''";
  if (/[\s'"\\]/.test(arg)) return JSON.stringify(arg);
  return arg;
}

export function formatArgv(argv: readonly string[]): string {
  return argv.map(quoteArg).join(" ");
}

/** Lines that name the conda yaml / container actually selected for this try-run. */
export function tryRunEnvLines(input: {
  env: { condaYaml?: string; containerImage?: string };
  via: TryRunVia;
  language: NotebookLanguage;
  note?: string;
}): string[] {
  const directives = scriptEnvDirectives(input.env);
  const lines = [directives.length ? directives.join("\n") : "未设置 conda / container"];
  if (input.note) lines.push(input.note);
  if (input.via === "host") lines.push(`选用本机 ${scriptInterpreter(input.language)}`);
  if (input.via === "conda" && input.env.condaYaml) lines.push(`选用 conda ${gstr(input.env.condaYaml)}`);
  if (input.via === "container" && input.env.containerImage) lines.push(`选用 container ${gstr(input.env.containerImage)}`);
  return lines;
}

/** Demo mode names the same fields and does not start conda or a container. */
export function demoTryRunLines(
  env: { condaYaml?: string; containerImage?: string },
  language: NotebookLanguage,
): string[] {
  if (!env.condaYaml && !env.containerImage) return tryRunEnvLines({ env, via: "host", language });
  return [
    scriptEnvDirectives(env).join("\n"),
    "演示模式不启动这份环境。真正执行请用 pnpm dev:real。",
  ];
}

export function buildTryRunHeader(lines: readonly string[], commands: readonly string[]): string {
  return [...lines, ...commands.map((command) => `$ ${command}`)].join("\n");
}

export function hostTryRunCommand(language: NotebookLanguage, entry: string, argv: readonly string[]): string {
  return tryRunCommand(language, entry, argv);
}

/** Keep the environment header when the tool output is long. */
export function clipTryRunLog(header: string, rest: string, limit = 12_000): string {
  const tail = rest.trim();
  const body = tail ? `${header}\n${tail}` : header;
  if (body.length <= limit) return body;
  if (header.length + 2 >= limit) return header.slice(0, limit);
  const room = limit - header.length - 2;
  return `${header}\n…${tail.slice(-room)}`;
}
