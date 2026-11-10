import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gstr } from "@/features/project/groovy";
import { launchTools, profileList, renderRunConfig, type LaunchConfig } from "@/features/project/launch";
import type { PipelineParams } from "@/features/workflow/types";
import { cancelScript, launchScript, parseLaunch, parsePoll, parseProbe, parseSize, parseStat, pollScript, probeScript, remoteLayout, sizeScript, statScript, taskLogScript } from "../ssh";
import type { RemoteHost, RemoteProbe, RemoteRunState } from "../types";
import type { SshSession } from "./session";

/** Files a finished head leaves in its attempt directory on the host, fetched back for the run page. */
export const ATTEMPT_FILES = ["trace.tsv", "report.html", "timeline.html", "dag.html", "nextflow.log", "console.log", "exit-code"];
/** Results larger than this stay on the host; the run page then shows where they are. */
export const fetchLimitBytes = (env: NodeJS.ProcessEnv = process.env) => {
  const mb = Number(env.NEXTFLOW_STUDIO_REMOTE_FETCH_MAX_MB ?? 2048);
  return (Number.isFinite(mb) && mb >= 0 ? mb : 2048) * 1024 ** 2;
};

export async function probeHost(session: SshSession, extraTools: string[] = []): Promise<RemoteProbe & { tools: string[] }> {
  return parseProbe(await session.script(probeScript(session.host, extraTools), { login: true, timeoutMs: 90_000 }));
}

/** Missing commands for this launch on the host, as messages. Each entry of `launchTools` lists alternatives. */
export function missingRemoteTools(launch: LaunchConfig, found: string[]): string[] {
  return launchTools(launch)
    .filter((alternatives) => !alternatives.some((name) => found.includes(name)))
    .map((alternatives) => `集群上找不到 ${alternatives.join(" 或 ")}`);
}

/** run.config for the host: the executor settings plus trace and reports in the remote attempt directory. */
export function remoteRunConfig(launch: LaunchConfig, attemptDir: string): string {
  return [
    renderRunConfig(launch).trimEnd(),
    "trace.enabled = true", "trace.raw = true",
    `trace.file = ${gstr(`${attemptDir}/trace.tsv`)}`,
    "trace.fields = 'task_id,hash,native_id,process,name,tag,status,exit,submit,start,complete,duration,realtime,cpus,%cpu,peak_rss,workdir,attempt'",
    `report.file = ${gstr(`${attemptDir}/report.html`)}`,
    `timeline.file = ${gstr(`${attemptDir}/timeline.html`)}`,
    `dag.file = ${gstr(`${attemptDir}/dag.html`)}`,
    "",
  ].join("\n");
}

export interface RemoteStart {
  host: RemoteHost;
  session: SshSession;
  runId: string;
  workflowId: string;
  runName: string;
  /** The workflow's local launch directory, already synced to the run's project. */
  projectDir: string;
  /** The run's local attempt directory; copies of the remote run.config and params.json go here. */
  attemptDir: string;
  launch: LaunchConfig;
  params: PipelineParams;
  /** `-resume <session>` of an earlier run on the same host. */
  resumeSession?: string;
  /** Workspace files and folders to copy into the project's folder on the host first (see `syncRemoteData`). */
  data?: { root: string; project: string; paths: string[] };
  signal?: AbortSignal;
}

/** The files under each workspace path (a file, or every file in a folder), relative to `root`. */
async function workspaceFiles(root: string, paths: string[]): Promise<string[]> {
  const files = new Set<string>();
  const walk = async (relative: string): Promise<void> => {
    const info = await stat(join(root, relative));
    if (info.isFile()) { files.add(relative); return; }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      await walk(`${relative}/${entry.name}`);
    }
  };
  for (const path of paths) await walk(path);
  return [...files].sort();
}

/**
 * Copies workspace data into `dataDir` on the host, at the same relative paths, so a samplesheet's relative file
 * columns still line up. Files the host already has with the same size and modification time are skipped; tar keeps
 * mtimes, so an unchanged file is sent once.
 */
export async function syncRemoteData(session: SshSession, root: string, dataDir: string, paths: string[]) {
  const files = await workspaceFiles(root, paths);
  const remote = parseStat(await session.script(statScript(dataDir, files), { timeoutMs: 120_000 }));
  const changed: string[] = [];
  for (const file of files) {
    const local = await stat(join(root, file));
    const there = remote.get(file);
    if (!there || there.size !== local.size || there.mtime !== Math.floor(local.mtimeMs / 1000)) changed.push(file);
  }
  await session.uploadFiles(root, dataDir, changed);
  return { files: files.length, uploaded: changed.length };
}

/** Params that name synced workspace data point into `dataDir` on the host; the rest stay as they are. */
export function remoteDataParams(params: PipelineParams, dataDir: string, paths: string[]): PipelineParams {
  const out: PipelineParams = { ...params, studio_project_root: dataDir };
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string" && paths.includes(value)) out[name] = `${dataDir}/${value}`;
  }
  return out;
}

/**
 * Prepares and starts a run on the host: checks the tools, copies the project into the workflow's launch directory
 * there, writes run.config and params.json into the attempt directory, and starts Nextflow under nohup.
 */
export async function startRemoteRun(input: RemoteStart) {
  const { host, session } = input;
  const probe = await probeHost(session, launchTools(input.launch).flat());
  if (!probe.ok || !probe.baseDir) throw new Error(probe.error ?? "无法检查集群环境");
  const missing = missingRemoteTools(input.launch, probe.tools);
  if (missing.length) throw new Error(missing.join("；"));
  input.signal?.throwIfAborted();
  const layout = remoteLayout(probe.baseDir, input.workflowId, input.runId, input.data?.project);
  const workDir = input.launch.workDir === "work" || !input.launch.workDir ? layout.workDir : input.launch.workDir;
  const launch: LaunchConfig = { ...input.launch, workDir };
  const synced = input.data?.paths.length ? await syncRemoteData(session, input.data.root, layout.dataDir, input.data.paths) : undefined;
  input.signal?.throwIfAborted();
  const params: PipelineParams = {
    ...(synced ? remoteDataParams(input.params, layout.dataDir, input.data!.paths) : input.params),
    outdir: layout.outdir, publish_dir_mode: "copy", trace_report_suffix: input.runId,
  };
  const runConfig = remoteRunConfig(launch, layout.attemptDir);
  const staging = join(input.attemptDir, "remote");
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "run.config"), runConfig);
  await writeFile(join(staging, "params.json"), JSON.stringify(params, null, 2));
  // Local run state in the launch directory (another machine's .nextflow, a local work dir) never goes to the host.
  await session.upload(input.projectDir, layout.launchDir, ["./.nextflow", "./.nextflow.log*", "./work", "./results"]);
  await session.upload(staging, layout.attemptDir);
  input.signal?.throwIfAborted();
  const profiles = profileList(launch);
  const args = [
    "-log", `${layout.attemptDir}/nextflow.log`, "run", ".", "-ansi-log", "false",
    ...(profiles ? ["-profile", profiles] : []),
    "-c", `${layout.attemptDir}/run.config`, "-params-file", `${layout.attemptDir}/params.json`, "-name", input.runName,
    ...(input.resumeSession ? ["-resume", input.resumeSession] : []),
  ];
  const started = parseLaunch(await session.script(launchScript(host, { launchDir: layout.launchDir, attemptDir: layout.attemptDir, args }), { login: true, timeoutMs: 120_000 }));
  const state: RemoteRunState = {
    hostId: host.id, hostName: host.name, launchDir: layout.launchDir, attemptDir: layout.attemptDir, outdir: layout.outdir, workDir,
    pid: started.pid, pidStart: started.pidStart,
  };
  const command = `ssh ${host.user ? `${host.user}@` : ""}${host.host} 'cd ${layout.launchDir} && nohup ${host.nextflow?.trim() || "nextflow"} ${args.join(" ")} &'`;
  return { state, launch, runConfig, command, versions: probe.nextflow, ...(synced ? { data: { dir: layout.dataDir, ...synced } } : {}) };
}

export async function pollRemoteRun(session: SshSession, state: RemoteRunState) {
  if (!state.pid) return { alive: false, trace: "", console: "" } as ReturnType<typeof parsePoll>;
  return parsePoll(await session.script(pollScript({ attemptDir: state.attemptDir, pid: state.pid, pidStart: state.pidStart ?? "" }), { timeoutMs: 60_000 }));
}

/** A task's logs on the host. The work directory must sit inside the run's work root there. */
export async function remoteTaskLog(session: SshSession, state: RemoteRunState, workdir: string) {
  const root = `${state.workDir.replace(/\/+$/, "")}/`;
  if (!workdir.startsWith(root) || workdir.split("/").includes("..")) throw new Error("任务目录不在这次运行的 work 目录里");
  return session.script(taskLogScript(workdir), { timeoutMs: 60_000 });
}

export async function cancelRemoteRun(session: SshSession, state: RemoteRunState, signal: "TERM" | "KILL" = "TERM") {
  if (!state.pid) return;
  await session.script(cancelScript({ pid: state.pid, pidStart: state.pidStart ?? "" }, signal), { timeoutMs: 60_000 });
}

/**
 * After the head exits: brings back logs, reports, the trace and the launch directory's history, then the results
 * when they fit under the fetch limit. Returns the exit status the head wrote, if any.
 */
export async function collectRemoteRun(session: SshSession, state: RemoteRunState, localAttemptDir: string, localOutdir: string, limit = fetchLimitBytes()) {
  await session.download(state.attemptDir, ATTEMPT_FILES, localAttemptDir);
  await session.download(state.launchDir, [".nextflow/history"], join(localAttemptDir, "remote"));
  const resultsBytes = parseSize(await session.script(sizeScript(state.outdir), { timeoutMs: 120_000 }));
  const fetch = resultsBytes >= 0 && resultsBytes <= limit;
  if (fetch) await session.download(state.outdir, ["."], localOutdir);
  return { resultsBytes: Math.max(resultsBytes, 0), resultsLeftRemote: resultsBytes > 0 && !fetch };
}
