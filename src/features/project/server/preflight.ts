import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, cpus, homedir, totalmem } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { executorDef, launchTools, type LaunchConfig } from "../launch";
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

export async function preflight() {
  const nextflow = await executable("nextflow", process.env.NEXTFLOW_BIN);
  const nfCore = await executable("nf-core", process.env.NF_CORE_BIN, [
    join(homedir(), "miniconda3/bin/nf-core"), join(homedir(), "miniforge3/bin/nf-core"),
  ]);
  const docker = await executable("docker", process.env.DOCKER_BIN).catch(() => undefined);
  const git = await executable("git", process.env.GIT_BIN);
  const javaOverride = process.env.NEXTFLOW_JAVA_HOME;
  const java = await executable("java", javaOverride ? join(javaOverride, "bin/java") : undefined, []);
  // Prefer a supported Homebrew JDK over the system java shim / newer unsupported JDKs.
  const candidates = javaOverride ? [java] : [
    ...(process.env.JAVA_HOME ? [join(process.env.JAVA_HOME, "bin/java")] : []),
    ...["21", "25"].map((version) => `/opt/homebrew/opt/openjdk@${version}/bin/java`), java,
  ];
  let javaHome: string | undefined;
  let javaVersion = "";
  for (const candidate of candidates) {
    try {
      const output = await runCommand(candidate, ["-version"], { quiet: true, timeoutMs: 15_000 });
      const major = Number(output.match(/version "(\d+)/)?.[1]);
      if (major >= 17 && major <= 26) {
        javaHome = dirname(dirname(await realpath(candidate)));
        javaVersion = output.trim().split("\n")[0];
        break;
      }
    } catch { /* Check another installed JDK. */ }
  }
  if (!javaHome) throw new Error("Nextflow needs a supported Java 17–26. Set NEXTFLOW_JAVA_HOME to an installed JDK.");
  const env: NodeJS.ProcessEnv = { ...process.env, JAVA_HOME: javaHome, NXF_JAVA_HOME: javaHome, NXF_ANSI_LOG: "false", NXF_VER: "26.10.4" };
  env.PATH = [join(javaHome, "bin"), join(nfCore, ".."), docker ? join(docker, "..") : "", process.env.PATH].filter(Boolean).join(delimiter);
  // Java's Nextflow launcher does not support SOCKS proxy URLs. Explicit HTTP overrides win.
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    if (process.env.NEXTFLOW_HTTP_PROXY) env[key] = process.env.NEXTFLOW_HTTP_PROXY;
    else if (env[key] && !/^https?:\/\//i.test(env[key]!)) {
      process.stdout.write(`Ignoring unsupported ${key} for child tools; set NEXTFLOW_HTTP_PROXY to an HTTP proxy if needed.\n`);
      delete env[key];
    }
  }
  const check = (bin: string, args: string[]) => runCommand(bin, args, { env, quiet: true, timeoutMs: 30_000 });
  const [nextflowVersion, nfCoreVersion, gitVersion] = await Promise.all([
    check(nextflow, ["-version"]), check(nfCore, ["--version"]), check(git, ["--version"]),
  ]);
  const dockerInfo = docker
    ? JSON.parse((await check(docker, ["info", "--format", "{{json .}}"])).split("\n").find((line) => line.startsWith("{")) ?? "{}") as { ServerVersion: string; Architecture: string; NCPU: number; MemTotal: number }
    : undefined;
  if (dockerInfo && dockerInfo.MemTotal < 2 * 1024 ** 3) throw new Error("Docker needs at least 2 GiB of memory for the QC smoke test.");
  const hostArch = arch() === "x64" ? "x86_64" : arch() === "arm64" ? "aarch64" : arch();
  return {
    nextflow, nfCore, docker, git, env,
    versions: {
      nextflow: nextflowVersion.match(/version\s+([\d.]+)/)?.[1] ?? nextflowVersion.trim(),
      nfCore: nfCoreVersion.match(/nf-core, version\s+([\d.]+)/)?.[1] ?? nfCoreVersion.trim(),
      java: javaVersion, git: gitVersion.trim(), ...(dockerInfo ? { docker: dockerInfo.ServerVersion } : {}),
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
