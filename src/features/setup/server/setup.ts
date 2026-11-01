import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listKernelSpecs } from "@/features/notebook/server/kernels";
import { runCommand } from "@/features/project/server/command";
import { findJava, findNextflow, toolEnvironment } from "@/features/project/server/preflight";
import { store } from "@/lib/server/database";
import { dataDirectory } from "@/lib/server/paths";
import {
  appendInstallLog,
  installTool,
  managedPaths,
  nextflowPluginsDirectory,
  platformKey,
  pluginInstalled,
  seedBundledPlugins,
  TOOLCHAIN,
  WEBLOG_PLUGIN,
  type InstallableTool,
} from "@/lib/server/toolchain";
import type { CondaEnvironment, SetupStatus, ToolId, ToolStatus } from "../types";

/** One install at a time per tool, kept in the server process so the wizard can poll it. */
interface InstallJob { tool: InstallableTool; state: "installing" | "error"; log: string[]; error?: string }
const globalJobs = globalThis as typeof globalThis & { studioInstallJobs?: Map<InstallableTool, InstallJob> };
const jobs = () => globalJobs.studioInstallJobs ??= new Map();

const TOOL_INSTALLS: Partial<Record<ToolId, InstallableTool>> = { java: "java", nextflow: "nextflow", weblog: "weblog", conda: "micromamba", jupyter: "notebook-env" };

const quiet = (bin: string, args: string[], env?: NodeJS.ProcessEnv) => runCommand(bin, args, { env, quiet: true, timeoutMs: 30_000 });

async function condaEnvironments(env: NodeJS.ProcessEnv, kernelPrefixes: Set<string>): Promise<CondaEnvironment[]> {
  for (const bin of ["conda", "mamba", "micromamba"]) {
    try {
      const output = await quiet(bin, ["env", "list", "--json"], env);
      const parsed = JSON.parse(output.slice(output.indexOf("{"))) as { envs?: string[] };
      return (parsed.envs ?? []).map((prefix) => ({
        prefix,
        name: prefix.split("/").pop() ?? prefix,
        hasKernel: kernelPrefixes.has(prefix) || existsSync(join(prefix, "share", "jupyter", "kernels")),
      }));
    } catch { /* Try the next conda front end. */ }
  }
  return [];
}

function withJob(status: ToolStatus): ToolStatus {
  const install = TOOL_INSTALLS[status.id];
  const job = install ? jobs().get(install) : undefined;
  if (!job) return status;
  return { ...status, state: job.state, log: job.log.slice(-12), detail: job.error ?? status.detail };
}

export async function setupStatus(): Promise<SetupStatus> {
  const paths = managedPaths();
  await seedBundledPlugins(process.env.NEXTFLOW_STUDIO_BUNDLED_PLUGINS, paths).catch(() => false);
  const env = toolEnvironment();
  const tools: ToolStatus[] = [];

  const java = await findJava(env).catch(() => undefined);
  tools.push({
    id: "java", label: TOOLCHAIN.java.label, required: true,
    state: java ? "ok" : "missing", version: java?.version, path: java?.home,
    source: java ? (java.home.startsWith(paths.root) ? "managed" : "system") : undefined,
    detail: java ? undefined : "Nextflow 需要 Java 17–26",
    install: { label: "下载 Temurin JRE", version: TOOLCHAIN.java.version },
  });

  const nextflow = await findNextflow(env).catch(() => undefined);
  let nextflowVersion: string | undefined;
  if (nextflow && java) {
    nextflowVersion = await quiet(nextflow, ["-version"], { ...env, JAVA_HOME: java.home, NXF_JAVA_HOME: java.home })
      .then((out) => out.match(/version\s+([\d.]+)/)?.[1])
      .catch(() => undefined);
  }
  tools.push({
    id: "nextflow", label: TOOLCHAIN.nextflow.label, required: true,
    state: nextflow ? "ok" : "missing", version: nextflowVersion, path: nextflow,
    source: nextflow ? (nextflow.startsWith(paths.root) ? "managed" : "system") : undefined,
    install: { label: "下载 Nextflow", version: TOOLCHAIN.nextflow.version },
  });

  const weblog = pluginInstalled(paths.plugins) || pluginInstalled(nextflowPluginsDirectory(env));
  tools.push({
    id: "weblog", label: TOOLCHAIN.weblog.label, required: false,
    state: weblog ? "ok" : "missing", version: weblog ? TOOLCHAIN.weblog.version : undefined,
    source: weblog ? (pluginInstalled(paths.plugins) ? "managed" : "system") : undefined,
    detail: weblog ? undefined : "没有它也能运行，进度改为每隔几秒读取 trace 文件",
    install: { label: `预装 ${WEBLOG_PLUGIN}`, version: TOOLCHAIN.weblog.version },
  });

  const conda = await Promise.any(["conda", "mamba", "micromamba"].map(async (bin) => ({ bin, version: (await quiet(bin, ["--version"], env)).trim().split("\n").pop() })))
    .catch(() => undefined);
  tools.push({
    id: "conda", label: "conda / mamba", required: false,
    state: conda ? "ok" : "missing", version: conda?.version, path: conda?.bin,
    source: conda ? (existsSync(paths.micromamba) && conda.bin === "micromamba" ? "managed" : "system") : undefined,
    detail: conda ? undefined : "用 conda 或 mamba profile 运行时需要",
    install: { label: "安装 micromamba", version: TOOLCHAIN.micromamba.version },
  });

  const kernels = await listKernelSpecs();
  const python = kernels.kernels.filter((kernel) => kernel.language.toLowerCase() === "python");
  tools.push({
    id: "jupyter", label: "Jupyter 内核", required: false,
    state: kernels.available && python.length ? "ok" : "missing",
    version: python.map((kernel) => kernel.name).join("、") || undefined,
    detail: kernels.available ? undefined : kernels.message ?? "笔记本需要 ipykernel",
    install: { label: "创建笔记本环境（ipykernel + scanpy）", version: TOOLCHAIN.micromamba.version },
  });

  const docker = await quiet(process.env.DOCKER_BIN || "docker", ["info", "--format", "{{.ServerVersion}}"], env).then((out) => out.trim()).catch(() => undefined);
  tools.push({
    id: "docker", label: "Docker", required: false, state: docker ? "ok" : "missing", version: docker || undefined,
    detail: docker ? undefined : "可选：只有选择 docker profile 时需要",
  });

  const kernelPrefixes = new Set(python.map((kernel) => kernel.name));
  const migration = store().migration;
  return {
    tools: tools.map(withJob),
    ready: tools.filter((tool) => tool.required).every((tool) => tool.state === "ok"),
    platform: `${process.platform}-${process.arch}`,
    dataDirectory: dataDirectory(),
    condaEnvironments: await condaEnvironments(env, kernelPrefixes),
    migration: migration.applied.length ? { from: migration.from, to: migration.to, backup: migration.backup } : undefined,
    desktop: process.env.NEXTFLOW_STUDIO_DESKTOP === "1",
  };
}

/** Starts an install in the background. The wizard polls `setupStatus` until the tool is ready or failed. */
export function startInstall(id: ToolId): { started: boolean; message?: string } {
  const tool = TOOL_INSTALLS[id];
  if (!tool) return { started: false, message: "这个工具需要自行安装" };
  const platform = platformKey();
  if (!platform) return { started: false, message: `不支持在 ${process.platform}-${process.arch} 上自动安装` };
  if (jobs().get(tool)?.state === "installing") return { started: false, message: "正在安装" };
  const job: InstallJob = { tool, state: "installing", log: [] };
  jobs().set(tool, job);
  const paths = managedPaths();
  const log = (line: string) => {
    job.log.push(line);
    appendInstallLog(paths, tool, line).catch(() => {});
  };
  void (async () => {
    const env = toolEnvironment();
    const java = await findJava(env).catch(() => undefined);
    if (java) Object.assign(env, { JAVA_HOME: java.home, NXF_JAVA_HOME: java.home });
    await installTool(tool, {
      paths, platform, env, log,
      run: (bin, args, options) => runCommand(bin, args, { env: options?.env ?? env, timeoutMs: options?.timeoutMs ?? 900_000, quiet: true }),
    });
    log("完成");
    jobs().delete(tool);
  })().catch((error: unknown) => {
    job.state = "error";
    job.error = error instanceof Error ? error.message.slice(-2000) : String(error);
    log(`失败：${job.error}`);
  });
  return { started: true };
}

/** Last lines of a tool's install log, for diagnostics. */
export async function installLog(tool: InstallableTool): Promise<string> {
  return readFile(join(managedPaths().logs, `${tool}.log`), "utf8").catch(() => "");
}
