import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultLaunchConfig } from "@/features/project/launch";
import type { RemoteHost, RemoteRunState } from "../types";
import { cancelRemoteRun, collectRemoteRun, pollRemoteRun, startRemoteRun } from "./remote-run";
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

  it("explains a missing scheduler before it uploads anything", async () => {
    const session = new SshSession(host, { ...env, PATH: `/usr/bin:/bin:${process.env.PATH}` }, undefined);
    await expect(startRemoteRun({
      host, session, runId: "run4", workflowId: "wf4", runName: "remote_slurm", projectDir: project("slurm", "true"), attemptDir: join(root, "attempts", "run4"),
      launch: { ...defaultLaunchConfig(), executor: "slurm" }, params: {},
    })).rejects.toThrow("集群上找不到 sbatch");
    expect(existsSync(join(root, "cluster", "pipelines", "wf4"))).toBe(false);
  }, 120_000);
});
