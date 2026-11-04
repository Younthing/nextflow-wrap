import { access, chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_NEXTFLOW_VERSION, NEXTFLOW_VERSION_PATTERN } from "@/features/settings/nextflow-version";
import { downloadVerified, toolchainDirectory } from "@/lib/server/toolchain";
import { runCommand } from "./command";

export const parseNextflowVersion = (output: string) => output.match(/\bversion\s+(\d+\.\d+\.\d+\S*)/)?.[1];

/** Initialization may change PATH/Java, but the version selector remains authoritative for this launch. */
export function nextflowSetup(setup: string | undefined, version: string): string | undefined {
  if (!setup?.trim()) return undefined;
  if (!NEXTFLOW_VERSION_PATTERN.test(version)) throw new Error("Nextflow 版本号无效");
  return `${setup}\nexport NXF_VER=${version}`;
}

type Run = typeof runCommand;
const request = (url: string, env: NodeJS.ProcessEnv, run: Run) => run("curl", [
  "-fsSL", "--connect-timeout", "10", "--max-time", "30",
  ...(env.NEXTFLOW_HTTP_PROXY ? ["--proxy", env.NEXTFLOW_HTTP_PROXY] : []), url,
], { env, quiet: true, timeoutMs: 35_000 });

/** Resolve latest on every invocation; never silently fall back to an older cached version. */
export async function resolveNextflowVersion(env: NodeJS.ProcessEnv, run: Run = runCommand): Promise<string> {
  const selection = env.NEXTFLOW_STUDIO_NEXTFLOW_VERSION || DEFAULT_NEXTFLOW_VERSION;
  if (selection !== "latest" && !NEXTFLOW_VERSION_PATTERN.test(selection)) throw new Error("Nextflow 版本需要是 latest 或完整版本号，例如 26.10.4");
  const version = selection === "latest"
    ? (await request("https://www.nextflow.io/releases/latest/version", env, run)).trim().replace(/^v/, "")
    : selection;
  if (!NEXTFLOW_VERSION_PATTERN.test(version)) throw new Error("无法解析 Nextflow 最新稳定版本，请稍后重试或指定版本");
  return version;
}

/** Select an exact, verified runtime, including when the installed executable is a fixed-version -dist bundle. */
export async function selectNextflowRuntime(bin: string, base: NodeJS.ProcessEnv, run: Run = runCommand) {
  const version = await resolveNextflowVersion(base, run);
  const env: NodeJS.ProcessEnv = { ...base, NXF_VER: version };
  const target = join(toolchainDirectory(), "nextflow", version, "nextflow");
  const cached = await access(target).then(() => true, () => false);
  const candidate = base.NEXTFLOW_BIN ? bin : cached ? target : bin;
  const actual = await run(candidate, ["-version"], { env, quiet: true, timeoutMs: 120_000 }).then(parseNextflowVersion).catch(() => undefined);
  if (actual === version) return { bin: candidate, env, version };
  if (base.NEXTFLOW_BIN) throw new Error(`指定的 Nextflow 可执行文件未能运行 ${version}（实际：${actual ?? "启动失败"}），请更换可执行文件或版本设置`);

  const release = JSON.parse(await request(`https://api.github.com/repos/nextflow-io/nextflow/releases/tags/v${version}`, env, run)) as {
    tag_name?: string; assets?: { name: string; digest?: string; browser_download_url?: string }[];
  };
  const asset = release.assets?.find((item) => item.name === `nextflow-${version}-dist`);
  const sha = asset?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  const url = `https://github.com/nextflow-io/nextflow/releases/download/v${version}/nextflow-${version}-dist`;
  if (release.tag_name !== `v${version}` || !sha || asset?.browser_download_url !== url) throw new Error(`Nextflow ${version} 缺少可校验的官方发布包`);
  await mkdir(dirname(target), { recursive: true });
  // Separate temporary directories let the web server and runner prepare the same release concurrently.
  const temporary = await mkdtemp(join(dirname(target), ".download-"));
  try {
    const file = join(temporary, "nextflow");
    await downloadVerified(url, sha, file, (command, args) => run(command, [
      ...(env.NEXTFLOW_HTTP_PROXY ? ["--proxy", env.NEXTFLOW_HTTP_PROXY] : []), ...args,
    ], { env, quiet: true, timeoutMs: 180_000 }));
    await chmod(file, 0o755);
    const installed = parseNextflowVersion(await run(file, ["-version"], { env, quiet: true, timeoutMs: 120_000 }));
    if (installed !== version) throw new Error(`下载的 Nextflow 版本不匹配：需要 ${version}，实际 ${installed ?? "未知"}`);
    await rename(file, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { bin: target, env, version };
}
