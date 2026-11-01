import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, cpus, totalmem } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { executorDef, launchTools, type LaunchConfig } from "../launch";
import { nextflowCacheEnv } from "@/lib/server/paths";
import { managedPaths, managedToolEnv, nextflowPluginsDirectory, pluginInstalled, TOOLCHAIN, WEBLOG_PLUGIN } from "@/lib/server/toolchain";
import { runCommand } from "./command";

async function executable(name: string, override: string | undefined, fallbacks: string[] = [], path = process.env.PATH): Promise<string> {
  const candidates = override ? [override] : [
    ...(path ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, name)),
    ...fallbacks,
  ];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next installation. */ }
  }
  throw new Error(`Cannot find ${name}${override ? ` at ${override}` : "; add it to PATH or configure its executable path"}`);
}

/** Process environment with the managed toolchain folded in (system installs and user settings win). */
export function toolEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, ...managedToolEnv(base) };
}

/** A supported Java 17–26: an explicit override, JAVA_HOME, Homebrew, PATH, then the managed JRE. */
export async function findJava(env: NodeJS.ProcessEnv = toolEnvironment()): Promise<{ home: string; version: string }> {
  const javaOverride = env.NEXTFLOW_JAVA_HOME;
  const onPath = await executable("java", javaOverride ? join(javaOverride, "bin/java") : undefined, [], env.PATH).catch(() => undefined);
  const managed = managedPaths().javaHome;
  // Prefer a supported Homebrew JDK over the system java shim / newer unsupported JDKs.
  const candidates = javaOverride ? [join(javaOverride, "bin/java")] : [
    ...(env.JAVA_HOME ? [join(env.JAVA_HOME, "bin/java")] : []),
    ...["21", "25"].map((version) => `/opt/homebrew/opt/openjdk@${version}/bin/java`),
    ...(onPath ? [onPath] : []),
    ...(managed ? [join(managed, "bin/java")] : []),
  ];
  for (const candidate of candidates) {
    try {
      const output = await runCommand(candidate, ["-version"], { quiet: true, timeoutMs: 15_000 });
      const major = Number(output.match(/version "(\d+)/)?.[1]);
      if (major >= 17 && major <= 26) return { home: dirname(dirname(await realpath(candidate))), version: (output.split("\n").find((line) => /version "/.test(line)) ?? output).trim() };
    } catch { /* Check another installed JDK. */ }
  }
  throw new Error("Nextflow needs a supported Java 17–26. Set NEXTFLOW_JAVA_HOME to an installed JDK, or install one from the setup page.");
}

/** `NEXTFLOW_BIN`, then PATH, then the managed launcher. */
export const findNextflow = (env: NodeJS.ProcessEnv = toolEnvironment()) => executable("nextflow", env.NEXTFLOW_BIN, [managedPaths().nextflow], env.PATH);

export async function preflight() {
  const base = toolEnvironment();
  const nextflow = await findNextflow(base);
  const dockerCli = await executable("docker", base.DOCKER_BIN, [], base.PATH).catch(() => undefined);
  const { home: javaHome, version: javaVersion } = await findJava(base);
  // Conda environments and container images go to the shared cache that the notebook try-run also uses.
  const env: NodeJS.ProcessEnv = { ...base, ...nextflowCacheEnv(base), JAVA_HOME: javaHome, NXF_JAVA_HOME: javaHome, NXF_ANSI_LOG: "false", NXF_VER: TOOLCHAIN.nextflow.version };
  env.PATH = [join(javaHome, "bin"), dockerCli ? join(dockerCli, "..") : "", base.PATH].filter(Boolean).join(delimiter);
  // Java's Nextflow launcher does not support SOCKS proxy URLs. Explicit HTTP overrides win.
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    if (base.NEXTFLOW_HTTP_PROXY) env[key] = base.NEXTFLOW_HTTP_PROXY;
    else if (env[key] && !/^https?:\/\//i.test(env[key]!)) {
      process.stdout.write(`Ignoring unsupported ${key} for child tools; set NEXTFLOW_HTTP_PROXY to an HTTP proxy if needed.\n`);
      delete env[key];
    }
  }
  const check = (bin: string, args: string[]) => runCommand(bin, args, { env, quiet: true, timeoutMs: 30_000 });
  const nextflowVersion = await check(nextflow, ["-version"]);
  // Docker is optional. A CLI without a running daemon (Docker Desktop closed) counts as no Docker,
  // so the runner still starts and the shell, conda and other runtimes keep working.
  const dockerInfo = dockerCli
    ? await check(dockerCli, ["info", "--format", "{{json .}}"])
      .then((output) => JSON.parse(output.split("\n").find((line) => line.startsWith("{")) ?? "{}") as { ServerVersion?: string; Architecture: string; NCPU: number; MemTotal: number })
      .then((info) => (info.ServerVersion ? info : undefined))
      .catch(() => undefined)
    : undefined;
  const docker = dockerInfo ? dockerCli : undefined;
  // Live progress uses nf-weblog. Without it (offline and never installed) runs still work and the runner reads the trace instead.
  let weblog = pluginInstalled(nextflowPluginsDirectory(env));
  if (!weblog && env.NEXTFLOW_STUDIO_SKIP_PLUGIN_INSTALL !== "1") {
    const plugins = managedPaths().plugins;
    weblog = await runCommand(nextflow, ["plugin", "install", WEBLOG_PLUGIN], { env: { ...env, NXF_PLUGINS_DIR: plugins }, quiet: true, timeoutMs: 120_000 })
      .then(() => pluginInstalled(plugins)).catch(() => false);
    if (weblog && !env.NXF_PLUGINS_DIR) env.NXF_PLUGINS_DIR = plugins;
    if (!weblog) process.stdout.write(`${WEBLOG_PLUGIN} is not installed and could not be downloaded; live progress falls back to reading the trace file.\n`);
  }
  const hostArch = arch() === "x64" ? "x86_64" : arch() === "arm64" ? "aarch64" : arch();
  return {
    nextflow, docker, env, weblog,
    versions: {
      nextflow: nextflowVersion.match(/version\s+([\d.]+)/)?.[1] ?? nextflowVersion.trim(),
      java: javaVersion, ...(dockerInfo?.ServerVersion ? { docker: dockerInfo.ServerVersion } : {}),
    },
    resources: dockerInfo
      ? { architecture: dockerInfo.Architecture, cpus: dockerInfo.NCPU, memoryBytes: dockerInfo.MemTotal }
      : { architecture: hostArch, cpus: cpus().length, memoryBytes: totalmem() },
  };
}

/** Fails before Nextflow starts when the chosen executor or runtime has no command on PATH. */
export async function requireLaunchTools(config: LaunchConfig, env: NodeJS.ProcessEnv) {
  const missing: string[] = [];
  for (const alternatives of launchTools(config)) {
    const found = await Promise.any(alternatives.map((name) => executable(name, undefined, [], env.PATH))).catch(() => undefined);
    if (!found) missing.push(alternatives.join(" 或 "));
  }
  if (missing.length) {
    const what = config.executor === "local" ? `-profile ${config.engine}` : `${executorDef(config.executor).name} 执行器`;
    throw new Error(`${what} 需要 ${missing.join("、")}，但 runner 的 PATH 里找不到。请先安装，或换一个 profile / 执行器。`);
  }
}

export type RuntimeTools = Awaited<ReturnType<typeof preflight>>;
