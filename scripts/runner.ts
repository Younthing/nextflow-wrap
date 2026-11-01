import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { gzipSync } from "node:zlib";
import { gstr } from "@/features/project/groovy";
import { profileList, renderRunConfig } from "@/features/project/launch";
import { CommandError, logTail, runCommand, signalGroup, spawnDetached } from "@/features/project/server/command";
import { materializeProject, syncProject } from "@/features/project/server/materialize";
import { preflight, requireLaunchTools, type RuntimeTools } from "@/features/project/server/preflight";
import { smokeFastq } from "@/features/project/smoke-data";
import { usesSamplesheet } from "@/features/project/schema";
import { active } from "@/features/runs/server/service";
import { historySession, historyStatus, nextQueued, slotLimits } from "@/features/runs/server/queue";
import { ingestEvent, reconcileTrace, refreshProgress } from "@/features/runs/server/tasks";
import { resultFiles } from "@/features/runs/server/files";
import { publishMode } from "@/features/runs/server/publish-mode";
import { hostChainWorkflow, writeHostChainInputs } from "@/features/workflow/host-chain-demo";
import type { PipelineParams } from "@/features/workflow/types";
import { dataDirectory, store, type StoredExecution } from "@/lib/server/database";
import { workDirectory } from "@/lib/server/paths";
import { applyStoredSettings } from "@/lib/server/settings";
import { WEBLOG_PLUGIN } from "@/lib/server/toolchain";

// Runtime settings from the settings page (Java, Nextflow, proxy) apply before the preflight reads them.
applyStoredSettings();
const db = store();
const owner = randomUUID();
const limits = slotLimits();
let stopping = false;
let markStopped = () => {};
const stopped = new Promise<"stopping">((resolve) => { markStopped = () => resolve("stopping"); });
/** Runs this runner is working on. Stopping aborts a run that is still preparing and leaves a started Nextflow running. */
const work = new Map<string, { controller: AbortController; done: Promise<void> }>();
const eventTokens = new Map<string, string>();
const pidStart = (pid: number) => {
  try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim(); }
  catch { return ""; }
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sameProcess = (run: StoredExecution) => Boolean(run.pid && run.pidStart && alive(run.pid) && pidStart(run.pid) === run.pidStart);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanupContainers(tools: RuntimeTools, id: string) {
  if (!tools.docker) return;
  const ids = (await runCommand(tools.docker, ["ps", "-aq", "--filter", `label=nextflow-studio.run=${id}`], { env: tools.env, quiet: true, timeoutMs: 15_000 })).trim().split(/\s+/).filter((id) => /^[a-f0-9]+$/.test(id));
  if (ids.length) await runCommand(tools.docker, ["rm", "-f", ...ids], { env: tools.env, timeoutMs: 30_000 });
}

async function publishDiagnostics(run: StoredExecution) {
  const destination = join(String(run.detail.params.outdir), "pipeline_info");
  await mkdir(destination, { recursive: true });
  for (const name of ["trace.tsv", "report.html", "timeline.html", "dag.html"]) {
    await copyFile(join(run.attemptDir, name), join(destination, name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function seedDemo() {
  // Synthetic FASTQs and a samplesheet for the SAMPLESHEET node; the end-to-end user path reads them.
  const root = join(dataDirectory(), "demo");
  await mkdir(root, { recursive: true });
  for (const [name, seed, mate] of [["single_R1", 17, 1], ["paired_R1", 29, 1], ["paired_R2", 29, 2]] as const) {
    await writeFile(join(root, `${name}.fastq.gz`), gzipSync(smokeFastq(seed, mate)), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  }
  const input = join(root, "samplesheet.csv");
  await writeFile(input, `sample,fastq_1,fastq_2\nSINGLE,${join(root, "single_R1.fastq.gz")},\nPAIRED,${join(root, "paired_R1.fastq.gz")},${join(root, "paired_R2.fastq.gz")}\n`, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const hostRoot = join(dataDirectory(), "host-chain");
  writeHostChainInputs(hostRoot);
  const reads = join(hostRoot, "reads.fastq.gz");
  await writeFile(reads, gzipSync(smokeFastq(3, 1, 4)), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const hostInput = join(hostRoot, "samplesheet.csv");
  await writeFile(hostInput, `sample,fastq_1,fastq_2\nHOST,${reads},\n`, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  if (!db.workflow("hostchain")) {
    const demo = hostChainWorkflow(hostRoot, hostInput);
    demo.id = "hostchain";
    demo.updatedAt = new Date().toISOString();
    db.saveWorkflow(demo);
  }
}

function track(id: string, job: (controller: AbortController) => Promise<void>) {
  const controller = new AbortController();
  const cancelTimer = setInterval(() => { if (db.run(id, true)?.cancelRequested) controller.abort(); }, 300);
  const done = job(controller).catch(console.error).finally(() => {
    clearInterval(cancelTimer);
    eventTokens.delete(id);
    work.delete(id);
  });
  work.set(id, { controller, done });
}

async function failRun(id: string, tools: RuntimeTools, error: unknown) {
  await cleanupContainers(tools, id).catch(console.error);
  await reconcileTrace(db, db.run(id, true)!).catch(console.error);
  await publishDiagnostics(db.run(id, true)!).catch(console.error);
  db.updateRun(id, (record) => {
    record.detail.status = record.cancelRequested ? "cancelled" : stopping ? "interrupted" : "failed";
    record.detail.phase = undefined;
    record.detail.errorMessage = record.cancelRequested ? undefined : error instanceof Error ? error.message.slice(-6000) : String(error);
    record.detail.exitCode = error instanceof CommandError ? error.exitCode ?? undefined : undefined;
    record.detail.completedAt = new Date().toISOString();
    delete record.pid;
  });
  for (const task of db.tasks(id)) {
    if (["pending", "submitted", "running"].includes(task.status)) db.putTask(id, { ...task, status: "aborted" });
  }
  refreshProgress(db, id);
}

/** Poll a Nextflow head this runner did not start until it exits. */
async function waitForExit(run: StoredExecution): Promise<undefined | "stopping"> {
  while (sameProcess(run)) {
    if (stopping) return "stopping";
    await sleep(1000);
  }
  return undefined;
}

/**
 * Watch a started Nextflow head until it exits, then record the outcome.
 * `exited` is set when this runner spawned the head. A head adopted after a restart has no exit code,
 * so its outcome comes from `.nextflow/history`. When the runner stops, the head is left running.
 */
async function supervise(id: string, tools: RuntimeTools, controller: AbortController, exited?: Promise<number | null>, pollTrace = false) {
  const run = db.run(id, true)!;
  // A cluster or cloud head cancels its submitted jobs on SIGTERM, which can take a while.
  const grace = run.detail.launch.executor === "local" ? 10_000 : 60_000;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (!run.pid) return;
    signalGroup(run.pid, "SIGTERM");
    killTimer = setTimeout(() => { if (sameProcess(run)) signalGroup(run.pid!, "SIGKILL"); }, grace);
  };
  controller.signal.addEventListener("abort", terminate, { once: true });
  if (controller.signal.aborted) terminate();
  // Weblog events go to the port the head was started with; if this runner could not reuse it, read the trace instead.
  const traceTimer = pollTrace ? setInterval(() => { reconcileTrace(db, db.run(id, true)!).catch(console.error); }, tools.weblog ? 10_000 : 3_000) : undefined;
  let code: number | null | undefined;
  try {
    const result = await Promise.race([exited ?? waitForExit(run), stopped]);
    if (result === "stopping") return;
    code = result;
  } finally {
    controller.signal.removeEventListener("abort", terminate);
    clearTimeout(killTimer);
    clearInterval(traceTimer);
  }
  const history = await readFile(join(run.projectDir, ".nextflow/history"), "utf8").catch(() => "");
  const recorded = historyStatus(history, run.detail.runName);
  // Weblog reports the session id; without it the launch directory's history has it, and resume needs it.
  const session = historySession(history, run.detail.runName);
  if (session && !db.run(id, true)?.sessionId) db.updateRun(id, (record) => { record.sessionId = session; record.detail.nextflowSessionId = session; });
  if (code !== 0 && !(code === undefined && recorded === "OK")) {
    const reason = code === undefined ? `Nextflow 在 runner 停止期间结束，history 记录为 ${recorded ?? "未完成"}` : `${tools.nextflow} exited with ${code ?? "a signal"}`;
    const tail = await logTail(join(run.attemptDir, "console.log"));
    throw new CommandError(`${reason}\n${tail}`, code ?? null, tail);
  }
  db.updateRun(id, (record) => { record.detail.phase = "finalizing"; record.detail.exitCode = 0; });
  await reconcileTrace(db, db.run(id)!);
  await publishDiagnostics(db.run(id)!);
  const files = await resultFiles(db.run(id)!);
  await writeFile(join(run.attemptDir, "artifacts.json"), JSON.stringify(files, null, 2));
  db.updateRun(id, (record) => {
    record.detail.status = record.cancelRequested ? "cancelled" : "succeeded";
    record.detail.phase = undefined;
    record.detail.completedAt = new Date().toISOString();
    delete record.pid;
  });
}

async function execute(run: StoredExecution, tools: RuntimeTools, port: number, controller: AbortController) {
  const id = run.detail.id;
  const token = randomUUID();
  eventTokens.set(id, token);
  try {
    await mkdir(run.attemptDir, { recursive: true });
    const runtimeState = db.runtime()!;
    const requested = run.detail.launch;
    const local = requested.executor === "local";
    const docker = requested.engine === "docker";
    const cpus = Math.min(Number(requested.settings.cpus ?? 2), tools.resources.cpus);
    const memory = requested.settings.memory ?? "2.GB";
    const emulate = local && docker && tools.docker && (tools.resources.architecture === "aarch64" || tools.resources.architecture === "arm64");
    // The runner owns one local work directory for every workflow; a cluster or cloud run keeps the shared path
    // the user chose. A resumed run keeps the work directory its source ran in, so its cached tasks are found.
    const workDir = run.resumeFrom && isAbsolute(requested.workDir) ? requested.workDir
      : local || requested.workDir === "work" ? workDirectory() : requested.workDir;
    const launch = { ...requested, settings: local ? { ...requested.settings, cpus, memory } : requested.settings, workDir, extraProfiles: [...new Set([...requested.extraProfiles, ...(emulate ? ["emulate_amd64"] : [])])] };
    await requireLaunchTools(launch, tools.env);
    const outdir = join(run.attemptDir, "results");
    const params: PipelineParams = { ...run.detail.params, outdir, publish_dir_mode: await publishMode(workDir, outdir), trace_report_suffix: id };
    if (usesSamplesheet(run.detail.workflow)) {
      const input = String(params.input ?? "");
      // Web launches use explicit host paths; the server cannot read a browser's filesystem.
      if (!input.startsWith("/")) throw new Error("请输入 runner 主机上样本表的绝对路径");
      await access(input);
    }
    // The project generated at submit time is what runs, even if a module is republished meanwhile.
    // It is written into the workflow's stable launch directory (unchanged files keep their mtime, so
    // their tasks stay cached) and copied next to the attempt as a read-only record of what ran.
    await syncProject(run.detail.project, run.projectDir);
    await materializeProject(run.detail.project, join(run.attemptDir, "project"));
    if (run.resumeFrom) {
      await access(join(run.projectDir, ".nextflow/cache", run.sessionId!));
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(workDir)) await access(workDir);
    }
    controller.signal.throwIfAborted();
    const emulation = launch.extraProfiles.includes("emulate_amd64") ? " --platform=linux/amd64" : "";
    const runConfig = [
      renderRunConfig(launch),
      ...(local ? [`executor.cpus = ${cpus}`, `executor.memory = ${gstr(String(memory))}`, "executor.queueSize = 2"] : []),
      ...(!docker ? [] : [`docker.runOptions = ${gstr(`-u ${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0} --label nextflow-studio.run=${id}${emulation}`)}`]),
      // Without the plugin (offline and never installed) the runner polls the trace file instead.
      ...(tools.weblog ? [
        `plugins { id '${WEBLOG_PLUGIN}' }`,
        `weblog { enabled = true; url = ${gstr(`http://127.0.0.1:${port}/events/${id}/${token}`)} }`,
      ] : []),
      "trace.enabled = true", "trace.raw = true",
      `trace.file = ${gstr(join(run.attemptDir, "trace.tsv"))}`,
      "trace.fields = 'task_id,hash,native_id,process,name,tag,status,exit,submit,start,complete,duration,realtime,cpus,%cpu,peak_rss,workdir,attempt'",
      `report.file = ${gstr(join(run.attemptDir, "report.html"))}`,
      `timeline.file = ${gstr(join(run.attemptDir, "timeline.html"))}`,
      `dag.file = ${gstr(join(run.attemptDir, "dag.html"))}`,
      "",
    ].join("\n");
    const profiles = profileList(launch);
    const args = ["-log", join(run.attemptDir, "nextflow.log"), "run", ".", "-ansi-log", "false", ...(profiles ? ["-profile", profiles] : []), "-c", join(run.attemptDir, "run.config"), "-params-file", join(run.attemptDir, "params.json"), "-name", run.detail.runName];
    if (run.resumeFrom) args.push("-resume", run.sessionId!);
    await writeFile(join(run.attemptDir, "params.json"), JSON.stringify(params, null, 2));
    await writeFile(join(run.attemptDir, "run.config"), runConfig);
    await writeFile(join(run.attemptDir, "manifest.json"), JSON.stringify({ workflow: run.detail.workflow, versions: runtimeState.versions, resources: tools.resources, executable: tools.nextflow, args }, null, 2));
    if (stopping) throw new Error("Runner 正在停止");
    const head = await spawnDetached(tools.nextflow, args, { cwd: run.projectDir, env: tools.env, logPath: join(run.attemptDir, "console.log") });
    db.updateRun(id, (record) => {
      record.detail.params = params;
      record.detail.launch = launch;
      record.detail.runConfig = runConfig;
      record.detail.command = [tools.nextflow, ...args.map((arg) => JSON.stringify(arg))].join(" ");
      record.detail.status = "running";
      if (record.detail.phase === "preparing") record.detail.phase = "executing";
      record.detail.startedAt = new Date().toISOString();
      record.pid = head.pid;
      record.pidStart = pidStart(head.pid);
      record.eventPort = port;
      record.eventToken = token;
    });
    await supervise(id, tools, controller, head.exited, !tools.weblog);
  } catch (error) {
    await failRun(id, tools, error);
  }
}

/** Take over the active runs of a runner that is gone. A started head is watched again, not killed. */
function adoptOrphans(tools: RuntimeTools, port: number) {
  for (const run of db.runs(true).filter((run) => active(run) && run.owner && run.owner !== owner)) {
    const id = run.detail.id;
    if (!run.pid) {
      db.updateRun(id, (record) => {
        record.detail.status = record.cancelRequested ? "cancelled" : "interrupted";
        record.detail.phase = undefined;
        record.detail.completedAt = new Date().toISOString();
        record.detail.errorMessage = record.cancelRequested ? undefined : "Runner 在准备阶段退出；请检查日志后重新运行";
      });
      continue;
    }
    db.updateRun(id, (record) => { record.owner = owner; });
    if (run.eventToken) eventTokens.set(id, run.eventToken);
    console.log(`Adopting run ${id} (pid ${run.pid}${sameProcess(run) ? "" : ", already exited"})`);
    track(id, (controller) => supervise(id, tools, controller, undefined, run.eventPort !== port).catch((error: unknown) => failRun(id, tools, error)));
  }
}

async function main() {
  const previousPort = db.transaction(() => {
    const previous = db.runtime();
    if (previous && alive(previous.pid)) throw new Error(`Runner ${previous.pid} 已在运行`);
    db.setRuntime({ owner, pid: process.pid, heartbeat: Date.now(), eventPort: previous?.eventPort, error: "正在检查运行环境" });
    return previous?.eventPort;
  });
  const heartbeat = setInterval(() => {
    const state = db.runtime();
    if (state?.owner === owner) db.setRuntime({ ...state, heartbeat: Date.now() });
  }, 2000);
  const events = createServer(async (request, response) => {
    try {
      const [, route, id, token] = (request.url ?? "").split("/");
      if (request.method !== "POST" || route !== "events" || !token || eventTokens.get(id) !== token) { response.writeHead(403).end(); return; }
      let text = "";
      for await (const chunk of request) { text += chunk; if (text.length > 2 * 1024 ** 2) throw new Error("Event too large"); }
      ingestEvent(db, id, JSON.parse(text));
      response.writeHead(200).end("ok");
    } catch (error) { console.error("Nextflow event:", error); response.writeHead(400).end(); }
  });
  const listen = (port: number) => new Promise<void>((resolve, reject) => {
    events.once("error", reject);
    events.listen(port, "127.0.0.1", () => { events.removeListener("error", reject); resolve(); });
  });
  try {
    const tools = await preflight();
    await seedDemo();
    // Reuse the last port so heads that outlived the previous runner keep reporting events.
    await (previousPort ? listen(previousPort).catch(() => listen(0)) : listen(0));
    const port = (events.address() as { port: number }).port;
    adoptOrphans(tools, port);
    db.setRuntime({ owner, pid: process.pid, heartbeat: Date.now(), eventPort: port, versions: tools.versions, resources: tools.resources });
    console.log(`Runner ready. Data: ${dataDirectory()}; event port: ${port}; slots: local ${limits.local}, cluster/cloud ${limits.remote}; live progress: ${tools.weblog ? WEBLOG_PLUGIN : "trace polling"}`);
    while (!stopping) {
      const queued = db.transaction(() => {
        const next = nextQueued(db.runs(), limits);
        if (!next) return undefined;
        // Claim inside the transaction; use SQL directly to avoid a nested transaction.
        next.owner = owner;
        next.detail.phase = "preparing";
        db.db.prepare("UPDATE runs SET data=? WHERE id=?").run(JSON.stringify(next), next.detail.id);
        return next;
      });
      if (queued) track(queued.detail.id, (controller) => execute(queued, tools, port, controller));
      else await Promise.race([sleep(500), stopped]);
    }
    await Promise.all([...work.values()].map((job) => job.done));
    const left = db.runs().filter((run) => active(run) && run.owner === owner && run.pid).length;
    if (left) console.log(`Runner stopped; ${left} Nextflow run(s) keep running and will be adopted on the next start`);
  } finally {
    clearInterval(heartbeat);
    events.close();
    const state = db.runtime();
    if (state?.owner === owner) db.setRuntime({ ...state, heartbeat: 0, error: "Runner 已停止" });
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    markStopped();
    for (const [id, job] of work) if (!db.run(id, true)?.pid) job.controller.abort();
  });
}
main().catch((error: unknown) => { console.error(error); const state = db.runtime(); if (state?.owner === owner) db.setRuntime({ ...state, error: error instanceof Error ? error.message : String(error), heartbeat: 0 }); process.exitCode = 1; });
