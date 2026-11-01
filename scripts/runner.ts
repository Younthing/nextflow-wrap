import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import catalog from "@/data/nf-core-modules.json";
import { generateProject } from "@/features/project/generate";
import { gstr } from "@/features/project/groovy";
import { profileList, renderRunConfig } from "@/features/project/launch";
import { CommandError, runCommand } from "@/features/project/server/command";
import { installComponents, materializeProject } from "@/features/project/server/materialize";
import { preflight, requireLaunchTools, type RuntimeTools } from "@/features/project/server/preflight";
import { smokeFastq } from "@/features/project/smoke-data";
import { NF_SCHEMA_VERSION } from "@/features/project/templates";
import { executionModuleIndex } from "@/features/runs/server/execution-index";
import { active } from "@/features/runs/server/service";
import { ingestEvent, reconcileTrace, refreshProgress } from "@/features/runs/server/tasks";
import { resultFiles } from "@/features/runs/server/files";
import { hostChainWorkflow, writeHostChainInputs } from "@/features/workflow/host-chain-demo";
import { qcDemoWorkflow } from "@/features/workflow/qc-demo";
import { dataDirectory, store, type StoredExecution } from "@/lib/server/database";

const db = store();
const owner = randomUUID();
let stopping = false;
let currentController: AbortController | undefined;
const eventTokens = new Map<string, string>();
const pidStart = (pid: number) => {
  try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim(); }
  catch { return ""; }
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

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
  const root = join(dataDirectory(), "demo");
  await mkdir(root, { recursive: true });
  for (const [name, seed, mate] of [["single_R1", 17, 1], ["paired_R1", 29, 1], ["paired_R2", 29, 2]] as const) {
    await writeFile(join(root, `${name}.fastq.gz`), gzipSync(smokeFastq(seed, mate)), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  }
  const input = join(root, "samplesheet.csv");
  await writeFile(input, `sample,fastq_1,fastq_2\nSINGLE,${join(root, "single_R1.fastq.gz")},\nPAIRED,${join(root, "paired_R1.fastq.gz")},${join(root, "paired_R2.fastq.gz")}\n`, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  if (!db.workflow("qc-smoke")) {
    const demo = qcDemoWorkflow(input);
    demo.params = { ...demo.params, custom_config_base: "", monochrome_logs: true };
    db.saveWorkflow(demo);
  }
  const hostRoot = join(dataDirectory(), "host-chain");
  writeHostChainInputs(hostRoot);
  const reads = join(hostRoot, "reads.fastq.gz");
  await writeFile(reads, gzipSync(smokeFastq(3, 1, 4)), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const hostInput = join(hostRoot, "samplesheet.csv");
  await writeFile(hostInput, `sample,fastq_1,fastq_2\nHOST,${reads},\n`, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  if (!db.workflow("hostchain")) {
    const demo = hostChainWorkflow(hostRoot, hostInput);
    demo.id = "hostchain";
    demo.params = { ...demo.params, custom_config_base: "", monochrome_logs: true };
    demo.updatedAt = new Date().toISOString();
    db.saveWorkflow(demo);
  }
}

async function execute(run: StoredExecution, tools: RuntimeTools, port: number) {
  const id = run.detail.id;
  const controller = new AbortController();
  currentController = controller;
  const cancelTimer = setInterval(() => { if (db.run(id, true)?.cancelRequested || stopping) controller.abort(); }, 300);
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
    // The runner owns a local work directory; a cluster or cloud run keeps the shared path the user chose.
    const workDir = local || requested.workDir === "work" ? join(run.projectDir, "../work") : requested.workDir;
    const launch = { ...requested, settings: local ? { ...requested.settings, cpus, memory } : requested.settings, workDir, extraProfiles: [...new Set([...requested.extraProfiles, ...(emulate ? ["emulate_amd64"] : [])])] };
    await requireLaunchTools(launch, tools.env);
    const params = { ...run.detail.params, input: String(run.detail.params.input), outdir: join(run.attemptDir, "results"), custom_config_base: "", publish_dir_mode: "copy", trace_report_suffix: id };
    // Web launches use explicit host paths; the server cannot read a browser's filesystem.
    if (!params.input.startsWith("/")) throw new Error("请输入 runner 主机上的绝对样本表路径；可先使用内置质控示例");
    await access(params.input);
    const project = generateProject(run.detail.workflow, executionModuleIndex(db.scriptModules()), { modulesSha: catalog.gitSha, registry: launch.registry });
    if (!run.resumeFrom) {
      await materializeProject(project, run.projectDir);
      await installComponents(project, run.projectDir, tools, controller.signal);
    } else {
      await access(join(run.projectDir, ".nextflow/cache", run.sessionId!));
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(workDir)) await access(workDir);
      await access(join(run.projectDir, "installed-components.json"));
    }
    controller.signal.throwIfAborted();
    const emulation = launch.extraProfiles.includes("emulate_amd64") ? " --platform=linux/amd64" : "";
    const runConfig = [
      renderRunConfig(launch),
      ...(local ? [`executor.cpus = ${cpus}`, `executor.memory = ${gstr(String(memory))}`, "executor.queueSize = 2"] : []),
      ...(!docker ? [] : [`docker.runOptions = ${gstr(`-u ${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0} --label nextflow-studio.run=${id}${emulation}`)}`]),
      `plugins { id 'nf-schema@${NF_SCHEMA_VERSION}'; id 'nf-weblog@1.2.0' }`,
      `weblog { enabled = true; url = ${gstr(`http://127.0.0.1:${port}/events/${id}/${token}`)} }`,
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
    await writeFile(join(run.attemptDir, "manifest.json"), JSON.stringify({ workflow: run.detail.workflow, versions: runtimeState.versions, resources: tools.resources, executable: tools.nextflow, args, modulesSha: catalog.gitSha }, null, 2));
    db.updateRun(id, (record) => {
      record.detail.params = params;
      record.detail.launch = launch;
      record.detail.runConfig = runConfig;
      record.detail.command = [tools.nextflow, ...args.map((arg) => JSON.stringify(arg))].join(" ");
      record.detail.status = "running";
      record.detail.phase = "executing";
      record.detail.startedAt = new Date().toISOString();
    });
    await runCommand(tools.nextflow, args, {
      cwd: run.projectDir, env: tools.env, logPath: join(run.attemptDir, "console.log"), timeoutMs: 24 * 60 * 60_000, signal: controller.signal,
      onSpawn: (pid) => { db.updateRun(id, (record) => { record.pid = pid; record.pidStart = pidStart(pid); }); },
    });
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
  } catch (error) {
    await cleanupContainers(tools, id).catch(console.error);
    await reconcileTrace(db, db.run(id)!).catch(console.error);
    await publishDiagnostics(db.run(id)!).catch(console.error);
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
  } finally {
    clearInterval(cancelTimer);
    eventTokens.delete(id);
    currentController = undefined;
  }
}

async function main() {
  db.transaction(() => {
    const previous = db.runtime();
    if (previous && alive(previous.pid)) throw new Error(`Runner ${previous.pid} 已在运行`);
    db.setRuntime({ owner, pid: process.pid, heartbeat: Date.now(), error: "正在检查运行环境" });
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
  try {
    const tools = await preflight();
    await seedDemo();
    await new Promise<void>((resolve, reject) => { events.once("error", reject); events.listen(0, "127.0.0.1", resolve); });
    const port = (events.address() as { port: number }).port;
    for (const run of db.runs(true).filter((run) => active(run) && run.owner && run.owner !== owner)) {
      if (run.pid && run.pidStart && pidStart(run.pid) === run.pidStart) {
        try { process.kill(-run.pid, "SIGTERM"); } catch { /* Already gone. */ }
        const deadline = Date.now() + 10_000;
        while (alive(run.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
        if (alive(run.pid) && pidStart(run.pid) === run.pidStart) process.kill(-run.pid, "SIGKILL");
      }
      await cleanupContainers(tools, run.detail.id);
      await reconcileTrace(db, run);
      db.updateRun(run.detail.id, (record) => { record.detail.status = "interrupted"; record.detail.phase = undefined; record.detail.completedAt = new Date().toISOString(); record.detail.errorMessage = "Runner 上次异常退出；请检查日志后从此记录恢复"; delete record.pid; });
      for (const task of db.tasks(run.detail.id)) {
        if (["pending", "submitted", "running"].includes(task.status)) db.putTask(run.detail.id, { ...task, status: "aborted" });
      }
      refreshProgress(db, run.detail.id);
    }
    db.setRuntime({ owner, pid: process.pid, heartbeat: Date.now(), versions: tools.versions, resources: tools.resources });
    console.log(`Runner ready. Data: ${dataDirectory()}; event port: ${port}`);
    while (!stopping) {
      const queued = db.transaction(() => {
        const next = db.runs().reverse().find((run) => run.detail.status === "submitted" && run.detail.phase === "queued");
        if (!next) return undefined;
        // Claim inside the transaction; use SQL directly to avoid a nested transaction.
        next.owner = owner;
        next.detail.phase = "preparing";
        db.db.prepare("UPDATE runs SET data=? WHERE id=?").run(JSON.stringify(next), next.detail.id);
        return next;
      });
      if (queued) await execute(queued, tools, port);
      else await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    clearInterval(heartbeat);
    events.close();
    const state = db.runtime();
    if (state?.owner === owner) db.setRuntime({ ...state, heartbeat: 0, error: "Runner 已停止" });
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; currentController?.abort(); });
main().catch((error: unknown) => { console.error(error); const state = db.runtime(); if (state?.owner === owner) db.setRuntime({ ...state, error: error instanceof Error ? error.message : String(error), heartbeat: 0 }); process.exitCode = 1; });
