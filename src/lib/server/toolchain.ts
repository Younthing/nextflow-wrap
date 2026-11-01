import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { chmod, cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { dataDirectory, type PathEnv } from "./paths";

/**
 * The tools a desktop install needs, pinned to exact releases with their SHA-256.
 *
 * The first-run wizard reuses a compatible system install when there is one, and otherwise downloads these into
 * `<data>/toolchain/`. Tools are versioned folders, so the toolchain upgrades on its own schedule, apart from the app.
 * Every URL is an official GitHub release asset; each checksum was taken from the publisher's own `.sha256` file.
 */
export const TOOLCHAIN = {
  java: {
    label: "Java 运行时（Temurin JRE）",
    version: "21.0.10+7",
    assets: {
      "linux-x64": { url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz", sha256: "991be6ac6725e76109ecbd131d658f992dcbeacba3a8b4b6650302c8012b52fb" },
      "linux-arm64": { url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz", sha256: "3ca84da7c4f57eee8d7e7f0645dc904a3a06456d32b37a4dd57a5e7527245250" },
      "darwin-x64": { url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_mac_hotspot_21.0.10_7.tar.gz", sha256: "008d2bb904c0e07500b92bf4b0f8d434d694b13d5189f06358a52d46b1351f37" },
      "darwin-arm64": { url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz", sha256: "c3be8c87f1a5cdc727903546eb810e112f94cd7222dac6a9d3f3146ee932008d" },
    },
  },
  nextflow: {
    label: "Nextflow",
    version: "26.10.4",
    // The `-dist` launcher embeds the runtime jar, so it works offline from the first run.
    asset: { url: "https://github.com/nextflow-io/nextflow/releases/download/v26.10.4/nextflow-26.10.4-dist", sha256: "2cbda6e7fdbbb1e7a413973eff549653f566ba6bb7bdfbb58eb78d0f831fdec4" },
  },
  weblog: {
    label: "nf-weblog 插件（实时进度）",
    id: "nf-weblog",
    version: "1.2.0",
  },
  micromamba: {
    label: "micromamba（conda 环境）",
    version: "2.4.0-1",
    assets: {
      "linux-x64": { url: "https://github.com/mamba-org/micromamba-releases/releases/download/2.4.0-1/micromamba-linux-64", sha256: "6b64c543743b3fc680a8138fb0ed962d9c9066af5859c29b86f1ce04bed40b76" },
      "linux-arm64": { url: "https://github.com/mamba-org/micromamba-releases/releases/download/2.4.0-1/micromamba-linux-aarch64", sha256: "cbc9b04dbe48a096c6dc68d2c7cf0888021933c3f7c2c00b78e62bef4954d474" },
      "darwin-x64": { url: "https://github.com/mamba-org/micromamba-releases/releases/download/2.4.0-1/micromamba-osx-64", sha256: "c3e2f53629eba9b2f3508f91249c743cc297bb74ec8c59eadc8ce5da4d3f8db8" },
      "darwin-arm64": { url: "https://github.com/mamba-org/micromamba-releases/releases/download/2.4.0-1/micromamba-osx-arm64", sha256: "847de1cbad6916a1765b77f93bca6e6523fa4c9489c9494f33a3ad10898bcb10" },
    },
  },
  /** The default notebook environment created with micromamba when no Jupyter is found. */
  notebookEnv: {
    label: "笔记本环境（ipykernel + scanpy）",
    name: "nextflow-studio",
    packages: ["python=3.12", "ipykernel", "matplotlib", "scanpy", "python-igraph", "leidenalg"],
  },
} as const;

export const WEBLOG_PLUGIN = `${TOOLCHAIN.weblog.id}@${TOOLCHAIN.weblog.version}`;

export type PlatformKey = keyof typeof TOOLCHAIN.java.assets;

export function platformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): PlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return key in TOOLCHAIN.java.assets ? key as PlatformKey : undefined;
}

export const toolchainDirectory = (input?: PathEnv) => join(dataDirectory(input), "toolchain");

/** Folders the managed tools live in. Each version gets its own folder so an upgrade never half-replaces one. */
export function managedPaths(root = toolchainDirectory(), platform: NodeJS.Platform = process.platform) {
  const jreRoot = join(root, "jre", TOOLCHAIN.java.version);
  return {
    root,
    jreRoot,
    /** The Temurin archive unpacks to `jdk-<version>-jre/`, with `Contents/Home` on macOS. */
    javaHome: (() => {
      const top = existsSync(jreRoot) ? readdirSync(jreRoot).find((name) => name.startsWith("jdk")) : undefined;
      if (!top) return undefined;
      return platform === "darwin" ? join(jreRoot, top, "Contents", "Home") : join(jreRoot, top);
    })(),
    nextflow: join(root, "nextflow", TOOLCHAIN.nextflow.version, "nextflow"),
    micromamba: join(root, "micromamba", TOOLCHAIN.micromamba.version, "micromamba"),
    mambaRoot: join(root, "mamba"),
    notebookPython: join(root, "mamba", "envs", TOOLCHAIN.notebookEnv.name, "bin", "python"),
    plugins: join(root, "plugins"),
    logs: join(root, "logs"),
  };
}

/** Nextflow's plugin folder for the given environment: `NXF_PLUGINS_DIR`, else `$NXF_HOME/plugins`. */
export function nextflowPluginsDirectory(env: Partial<Record<string, string>> = process.env, home = homedir()): string {
  if (env.NXF_PLUGINS_DIR) return env.NXF_PLUGINS_DIR;
  return join(env.NXF_HOME || join(home, ".nextflow"), "plugins");
}

/** Nextflow unpacks a plugin as `<plugins>/<id>-<version>/`. */
export const pluginInstalled = (pluginsDir: string, id: string = TOOLCHAIN.weblog.id, version: string = TOOLCHAIN.weblog.version) =>
  existsSync(join(pluginsDir, `${id}-${version}`, "classes")) || existsSync(join(pluginsDir, `${id}-${version}`, "META-INF"));

/**
 * Environment additions so Nextflow, the runner and the notebook use the managed tools.
 * System installs and values the user set win: a managed tool only fills a gap.
 */
export function managedToolEnv(env: Partial<Record<string, string>> = process.env, paths = managedPaths()): Record<string, string> {
  const extra: Record<string, string> = {};
  const bins: string[] = [];
  if (existsSync(paths.micromamba)) {
    bins.push(join(paths.micromamba, ".."));
    if (!env.MAMBA_ROOT_PREFIX) extra.MAMBA_ROOT_PREFIX = paths.mambaRoot;
  }
  if (existsSync(paths.nextflow)) bins.push(join(paths.nextflow, ".."));
  // An offline install keeps nf-weblog in the managed folder; a user's own plugin folder is left alone.
  if (!env.NXF_PLUGINS_DIR && pluginInstalled(paths.plugins) && !pluginInstalled(nextflowPluginsDirectory(env))) extra.NXF_PLUGINS_DIR = paths.plugins;
  if (bins.length) extra.PATH = [...(env.PATH ?? "").split(delimiter).filter(Boolean), ...bins].join(delimiter);
  return extra;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export class ChecksumError extends Error {}

/** Download through curl (it honours the system proxy settings) and refuse a file whose SHA-256 differs. */
export async function downloadVerified(
  url: string,
  sha256: string,
  destination: string,
  run: (bin: string, args: string[]) => Promise<unknown>,
): Promise<void> {
  const partial = `${destination}.partial`;
  await mkdir(join(destination, ".."), { recursive: true });
  await run("curl", ["-fsSL", "--retry", "3", "-o", partial, url]);
  const actual = await sha256File(partial);
  if (actual !== sha256) {
    await rm(partial, { force: true });
    throw new ChecksumError(`校验失败：${url}\n期望 ${sha256}\n实际 ${actual}`);
  }
  await rename(partial, destination);
}

export type InstallableTool = "java" | "nextflow" | "weblog" | "micromamba" | "notebook-env";

export interface InstallContext {
  paths: ReturnType<typeof managedPaths>;
  platform: PlatformKey;
  /** Runs a command; rejects with its output when it fails. */
  run: (bin: string, args: string[], options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<string>;
  /** Environment of the runner, used to find the Java and Nextflow that install the plugin. */
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

/** Copy plugins shipped inside the app bundle (`NEXTFLOW_STUDIO_BUNDLED_PLUGINS`) into the managed folder. */
export async function seedBundledPlugins(bundled: string | undefined, paths = managedPaths()): Promise<boolean> {
  if (!bundled || !existsSync(bundled) || pluginInstalled(paths.plugins)) return false;
  await mkdir(paths.plugins, { recursive: true });
  for (const name of await readdir(bundled)) await cp(join(bundled, name), join(paths.plugins, name), { recursive: true, force: false, errorOnExist: false });
  return pluginInstalled(paths.plugins);
}

export async function installTool(tool: InstallableTool, context: InstallContext): Promise<void> {
  const { paths, platform, run, log } = context;
  if (tool === "java") {
    const asset = TOOLCHAIN.java.assets[platform];
    const archive = join(paths.root, "downloads", asset.url.split("/").pop()!);
    log(`下载 ${asset.url}`);
    await downloadVerified(asset.url, asset.sha256, archive, run);
    const staging = `${paths.jreRoot}.staging`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await run("tar", ["-xzf", archive, "-C", staging]);
    await rm(paths.jreRoot, { recursive: true, force: true });
    await rename(staging, paths.jreRoot);
    await rm(archive, { force: true });
    return;
  }
  if (tool === "nextflow") {
    log(`下载 ${TOOLCHAIN.nextflow.asset.url}`);
    await downloadVerified(TOOLCHAIN.nextflow.asset.url, TOOLCHAIN.nextflow.asset.sha256, paths.nextflow, run);
    await chmod(paths.nextflow, 0o755);
    return;
  }
  if (tool === "micromamba") {
    const asset = TOOLCHAIN.micromamba.assets[platform];
    log(`下载 ${asset.url}`);
    await downloadVerified(asset.url, asset.sha256, paths.micromamba, run);
    await chmod(paths.micromamba, 0o755);
    return;
  }
  if (tool === "weblog") {
    // Nextflow fetches the plugin from its registry itself; the managed folder keeps it for offline runs.
    await mkdir(paths.plugins, { recursive: true });
    const nextflow = context.env.NEXTFLOW_BIN || (existsSync(paths.nextflow) ? paths.nextflow : "nextflow");
    log(`${nextflow} plugin install ${WEBLOG_PLUGIN}`);
    await run(nextflow, ["plugin", "install", WEBLOG_PLUGIN], { env: { ...context.env, NXF_PLUGINS_DIR: paths.plugins }, timeoutMs: 300_000 });
    if (!pluginInstalled(paths.plugins)) throw new Error(`${WEBLOG_PLUGIN} 安装后仍未在 ${paths.plugins} 找到`);
    return;
  }
  // notebook-env: a conda environment with ipykernel and scanpy, registered as a Jupyter kernel.
  if (!existsSync(paths.micromamba)) await installTool("micromamba", context);
  const env = { ...context.env, MAMBA_ROOT_PREFIX: paths.mambaRoot };
  log(`micromamba create -n ${TOOLCHAIN.notebookEnv.name} ${TOOLCHAIN.notebookEnv.packages.join(" ")}`);
  await run(paths.micromamba, ["create", "-y", "-n", TOOLCHAIN.notebookEnv.name, "-c", "conda-forge", ...TOOLCHAIN.notebookEnv.packages], { env, timeoutMs: 1_800_000 });
  await run(paths.notebookPython, ["-m", "ipykernel", "install", "--user", "--name", TOOLCHAIN.notebookEnv.name, "--display-name", "Python (Nextflow Studio)"], { env, timeoutMs: 120_000 });
}

/** Writes a line-oriented install log next to the toolchain; the diagnostics bundle includes it. */
export async function appendInstallLog(paths: ReturnType<typeof managedPaths>, tool: InstallableTool, text: string) {
  await mkdir(paths.logs, { recursive: true });
  await writeFile(join(paths.logs, `${tool}.log`), `${new Date().toISOString()} ${text}\n`, { flag: "a" });
}

