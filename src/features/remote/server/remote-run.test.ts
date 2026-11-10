import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultLaunchConfig } from "@/features/project/launch";
import type { RemoteHost, RemoteRunState } from "../types";
import { cancelRemoteRun, collectRemoteRun, pollRemoteRun, startRemoteRun, syncRemoteData } from "./remote-run";
import { SshSession } from "./session";

/**
 * A remote run end to end against the real Nextflow on PATH. scripts/ssh-shim.sh stands in for ssh and runs each
 * remote command on this machine, so upload, nohup launch, polling, cancel and fetch-back all run for real; only
 * the network hop is skipped.
 */
const root = mkdtempSync(join(tmpdir(), "studio-remote-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const env = { ...process.env, NEXTFLOW_STUDIO_SSH: resolve("scripts/ssh-shim.sh"), NXF_DISABLE_CHECK_LATEST: "true" };
const host: RemoteHost = { id: "shim", name: "本机模拟集群", host: "localhost", baseDir: join(root, "cluster") };

function project(name: string, script: string) {
  const dir = join(root, "local", name);
  mkdirSync(join(dir, ".nextflow"), { recursive: true });
  writeFileSync(join(dir, ".nextflow", "history"), "local history that must not be uploaded\n");
  writeFileSync(join(dir, "main.nf"), [
    "params.outdir = 'results'",
    "process GREET {",
    "  publishDir params.outdir, mode: 'copy'",
    "  input: val name",
    "  output: path 'hello.txt'",
    `  script: """${script}"""`,
    "}",
    "workflow { GREET(Channel.of('cluster')) }",
    "",
  ].join("\n"));
  return dir;
}

async function waitForExit(session: SshSession, state: RemoteRunState, timeoutMs = 150_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const poll = await pollRemoteRun(session, state);
    if (!poll.alive) return poll;
    if (Date.now() > until) throw new Error("远程运行没有结束");
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1000));
  }
}

describe("remote run over ssh", () => {
  it("uploads, starts under nohup, polls the trace and fetches the results", async () => {
    const session = new SshSession(host, env, undefined);
    const attemptDir = join(root, "attempts", "run1");
    const started = await startRemoteRun({
      host, session, runId: "run1", workflowId: "wf1", runName: "remote_ok", projectDir: project("ok", "echo hello $name > hello.txt"), attemptDir,
      launch: { ...defaultLaunchConfig(), settings: { cpus: 1, memory: "1.GB" } }, params: { greeting: "hi" },
    });
    const { state } = started;
    expect(state).toMatchObject({ hostId: "shim", launchDir: join(root, "cluster", "pipelines", "wf1"), workDir: join(root, "cluster", "work") });
    expect(state.pid).toBeGreaterThan(0);
    // The local launch directory's Nextflow state stays local.
    expect(existsSync(join(state.launchDir, "main.nf"))).toBe(true);
    expect(readFileSync(join(state.attemptDir, "params.json"), "utf8")).toContain(state.outdir);
    const poll = await waitForExit(session, state);
    expect(poll.exitCode).toBe(0);
    expect(poll.trace).toContain("GREET");
    const results = join(attemptDir, "results");
    const collected = await collectRemoteRun(session, state, attemptDir, results);
    expect(collected.resultsLeftRemote).toBe(false);
    expect(readFileSync(join(results, "hello.txt"), "utf8")).toBe("hello cluster\n");
    expect(readFileSync(join(attemptDir, "exit-code"), "utf8").trim()).toBe("0");
    expect(readFileSync(join(attemptDir, "trace.tsv"), "utf8")).toContain("COMPLETED");
    expect(readFileSync(join(attemptDir, "remote", ".nextflow", "history"), "utf8")).toMatch(/remote_ok\tOK/);
  }, 200_000);

  it("leaves results larger than the limit on the host", async () => {
    const session = new SshSession(host, env, undefined);
    const attemptDir = join(root, "attempts", "run2");
    const { state } = await startRemoteRun({
      host, session, runId: "run2", workflowId: "wf2", runName: "remote_big", projectDir: project("big", "head -c 200000 /dev/zero > hello.txt"), attemptDir,
      launch: defaultLaunchConfig(), params: {},
    });
    expect((await waitForExit(session, state)).exitCode).toBe(0);
    const collected = await collectRemoteRun(session, state, attemptDir, join(attemptDir, "results"), 1024);
    expect(collected).toMatchObject({ resultsLeftRemote: true });
    expect(collected.resultsBytes).toBeGreaterThan(1024);
    expect(existsSync(join(attemptDir, "results", "hello.txt"))).toBe(false);
  }, 200_000);

  it("stops a running head", async () => {
    const session = new SshSession(host, env, undefined);
    const { state } = await startRemoteRun({
      host, session, runId: "run3", workflowId: "wf3", runName: "remote_stop", projectDir: project("slow", "sleep 120; echo late > hello.txt"), attemptDir: join(root, "attempts", "run3"),
      launch: defaultLaunchConfig(), params: {},
    });
    // Let Nextflow get as far as starting the task.
    const until = Date.now() + 90_000;
    while (!(await pollRemoteRun(session, state)).trace.includes("GREET") && Date.now() < until) await new Promise((resolveSleep) => setTimeout(resolveSleep, 1000));
    await cancelRemoteRun(session, state);
    const poll = await waitForExit(session, state, 60_000);
    expect(poll.exitCode ?? -1).not.toBe(0);
  }, 200_000);

  it("copies workspace data to the project's folder on the host and reads it there", async () => {
    const session = new SshSession(host, env, undefined);
    const workspace = join(root, "workspace");
    mkdirSync(join(workspace, "data", "reads"), { recursive: true });
    writeFileSync(join(workspace, "data", "greeting.txt"), "hello from the workspace\n");
    writeFileSync(join(workspace, "data", "reads", "S1.fq"), "@r1\nACGT\n+\nIIII\n");
    mkdirSync(join(workspace, "data", "reads", "empty"));
    // A linked sample is uploaded as the file it points to; a link back up the tree is not followed forever.
    mkdirSync(join(workspace, "elsewhere"));
    writeFileSync(join(workspace, "elsewhere", "S3.fq"), "@r3\nGGGG\n+\nIIII\n");
    symlinkSync(join(workspace, "elsewhere", "S3.fq"), join(workspace, "data", "reads", "S3.fq"));
    symlinkSync(".", join(workspace, "data", "reads", "loop"));
    const dir = join(workspace, "local-project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main.nf"), [
      "params.outdir = 'results'",
      "process SHOW {",
      "  publishDir params.outdir, mode: 'copy'",
      "  input: path greeting",
      "  output: path 'shown.txt'",
      "  script: \"cat $greeting > shown.txt\"",
      "}",
      "workflow { SHOW(Channel.fromPath(params.greeting, checkIfExists: true)) }",
      "",
    ].join("\n"));
    const attemptDir = join(root, "attempts", "run5");
    const { state, data } = await startRemoteRun({
      host, session, runId: "run5", workflowId: "wf5", runName: "remote_data", projectDir: dir, attemptDir,
      launch: defaultLaunchConfig(), params: { greeting: "data/greeting.txt" },
      data: { root: workspace, project: "p1", paths: ["data/greeting.txt", "data/reads"] },
    });
    const dataDir = join(root, "cluster", "projects", "p1");
    expect(data).toMatchObject({ dir: dataDir, files: 3, uploaded: 3, removed: 0 });
    const inputs = data!.inputs;
    expect(inputs).toBe(join(root, "cluster", "snapshots", "p1", data!.digest));
    expect(readFileSync(join(dataDir, "data", "reads", "S1.fq"), "utf8")).toContain("ACGT");
    expect(existsSync(join(dataDir, "data", "reads", "empty"))).toBe(true);
    expect(readFileSync(join(dataDir, "data", "reads", "S3.fq"), "utf8")).toContain("GGGG");
    // The run reads its own snapshot of the data.
    const params = JSON.parse(readFileSync(join(state.attemptDir, "params.json"), "utf8"));
    expect(params).toMatchObject({ greeting: join(inputs, "data", "greeting.txt"), studio_project_root: inputs });
    expect((await waitForExit(session, state)).exitCode).toBe(0);
    await collectRemoteRun(session, state, attemptDir, join(attemptDir, "results"));
    expect(readFileSync(join(attemptDir, "results", "shown.txt"), "utf8")).toBe("hello from the workspace\n");
    // A resume over unchanged data reads the same snapshot paths, so Nextflow's task cache still matches.
    const again = await startRemoteRun({
      host, session, runId: "run6", workflowId: "wf5", runName: "remote_data_again", projectDir: dir, attemptDir: join(root, "attempts", "run6"),
      launch: defaultLaunchConfig(), params: { greeting: "data/greeting.txt" },
      data: { root: workspace, project: "p1", paths: ["data/greeting.txt", "data/reads"] },
    });
    expect(again.data).toMatchObject({ inputs, uploaded: 0 });
    await waitForExit(session, again.state);
    // The next run sends only what changed.
    writeFileSync(join(workspace, "data", "greeting.txt"), "hello again, a little longer\n");
    expect(await syncRemoteData(session, workspace, dataDir, ["data/greeting.txt", "data/reads"])).toMatchObject({ files: 3, uploaded: 1, removed: 0 });
    expect(readFileSync(join(dataDir, "data", "greeting.txt"), "utf8")).toBe("hello again, a little longer\n");
    // A synced folder is mirrored: a sample removed locally is removed on the host too.
    writeFileSync(join(workspace, "data", "reads", "S2.fq"), "@r2\nTTTT\n+\nIIII\n");
    rmSync(join(workspace, "data", "reads", "S1.fq"));
    const changed = await syncRemoteData(session, workspace, dataDir, ["data/greeting.txt", "data/reads"]);
    expect(changed).toMatchObject({ files: 3, uploaded: 1, removed: 1 });
    expect(changed.digest).not.toBe(data!.digest);
    expect(existsSync(join(dataDir, "data", "reads", "S1.fq"))).toBe(false);
    expect(readFileSync(join(dataDir, "data", "reads", "S2.fq"), "utf8")).toContain("TTTT");
    // A later sync for another run leaves this run's snapshot as it started.
    expect(readFileSync(join(inputs, "data", "greeting.txt"), "utf8")).toBe("hello from the workspace\n");
    expect(readFileSync(join(inputs, "data", "reads", "S1.fq"), "utf8")).toContain("ACGT");
  }, 200_000);

  it("explains a missing scheduler before it uploads anything", async () => {
    const session = new SshSession(host, { ...env, PATH: `/usr/bin:/bin:${process.env.PATH}` }, undefined);
    await expect(startRemoteRun({
      host, session, runId: "run4", workflowId: "wf4", runName: "remote_slurm", projectDir: project("slurm", "true"), attemptDir: join(root, "attempts", "run4"),
      launch: { ...defaultLaunchConfig(), executor: "slurm" }, params: {},
    })).rejects.toThrow("集群上找不到 sbatch");
    expect(existsSync(join(root, "cluster", "pipelines", "wf4"))).toBe(false);
  }, 120_000);
});
