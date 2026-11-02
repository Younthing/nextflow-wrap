import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { defaultLaunchConfig } from "@/features/project/launch";
import { missingRemoteTools } from "./server/remote-run";
import { cancelScript, launchScript, packScript, parseLaunch, parsePoll, parseProbe, parseSize, pollScript, remoteLayout, SAFE_PATH, sq, sshArgs } from "./ssh";
import type { RemoteHost } from "./types";

const host: RemoteHost = { id: "hpc", name: "HPC", host: "login.example.org", user: "ana", port: 2222, identityFile: "/Users/ana/.ssh/id_ed25519", baseDir: "~/nextflow-studio" };
const sh = (script: string) => execFileSync("sh", ["-c", script], { encoding: "utf8" });

describe("remote ssh helpers", () => {
  it("quotes words for a POSIX shell", () => {
    for (const word of ["plain", "it's", "a b", "$HOME", "`x`", "\"q\"", "back\\slash"]) {
      expect(sh(`printf %s ${sq(word)}`)).toBe(word);
    }
  });

  it("builds ssh options with the control socket, port and key", () => {
    expect(sshArgs(host, "/tmp/c")).toEqual([
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4",
      "-o", "ControlMaster=auto", "-o", "ControlPath=/tmp/c/%C", "-o", "ControlPersist=120",
      "-p", "2222", "-i", "/Users/ana/.ssh/id_ed25519", "-o", "IdentitiesOnly=yes", "--", "ana@login.example.org",
    ]);
    expect(sshArgs({ ...host, user: undefined, port: undefined, identityFile: undefined })).toEqual([
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "--", "login.example.org",
    ]);
  });

  it("accepts only plain paths for the ssh command line", () => {
    for (const ok of ["~", "~/nf", "/scratch/ana/nf-studio", "/a/b.c@d+e"]) expect(SAFE_PATH.test(ok)).toBe(true);
    for (const bad of ["", "nf", "/a b", "/a;rm -rf", "~ana/x", "/a/$(id)", "/a'b"]) expect(SAFE_PATH.test(bad)).toBe(false);
  });

  it("lays out launch, attempt, results and work directories under the base", () => {
    expect(remoteLayout("/scratch/ana/nfs/", "wf1", "run1")).toEqual({
      launchDir: "/scratch/ana/nfs/pipelines/wf1",
      attemptDir: "/scratch/ana/nfs/runs/run1",
      outdir: "/scratch/ana/nfs/runs/run1/results",
      workDir: "/scratch/ana/nfs/work",
    });
  });

  it("reads a connection test", () => {
    const probe = parseProbe([
      "Welcome to the cluster", "@@BASE /home/ana/nextflow-studio", "@@NEXTFLOW /opt/nf/bin/nextflow", "@@NFVERSION version 25.10.2",
      "@@JAVA openjdk version \"21.0.4\"", "@@TOOL sbatch", "@@TOOL apptainer", "@@TOOL conda",
    ].join("\n"));
    expect(probe).toMatchObject({ ok: true, baseDir: "/home/ana/nextflow-studio", nextflow: "/opt/nf/bin/nextflow (version 25.10.2)", schedulers: ["sbatch"], runtimes: ["apptainer", "conda"] });
    expect(parseProbe("@@BASE /home/ana/x\n@@NEXTFLOW \n@@JAVA \n")).toMatchObject({ ok: false, error: expect.stringContaining("找不到 Nextflow") });
    expect(parseProbe("")).toMatchObject({ ok: false, error: "无法创建或进入基础目录" });
  });

  it("names the commands a launch still needs on the host", () => {
    const slurm = { ...defaultLaunchConfig(), executor: "slurm" as const, engine: "apptainer" as const };
    expect(missingRemoteTools(slurm, ["apptainer"])).toEqual(["集群上找不到 sbatch"]);
    expect(missingRemoteTools(slurm, ["sbatch"])).toEqual([]);
    // On the login node itself the runtime must be there too.
    const login = { ...defaultLaunchConfig(), engine: "conda" as const };
    expect(missingRemoteTools(login, [])).toEqual(["集群上找不到 conda"]);
  });

  it("reads launch, poll and size output", () => {
    expect(parseLaunch("motd\n@@PID 4242\n@@START Mon Nov  2 01:00:00 2026\n")).toEqual({ pid: 4242, pidStart: "Mon Nov  2 01:00:00 2026" });
    expect(() => parseLaunch("@@ERROR 在集群上找不到 nextflow\n")).toThrow("在集群上找不到 nextflow");
    expect(() => parseLaunch("bash: oops")).toThrow("没能在集群上启动");
    expect(parsePoll("@@ALIVE 1\n@@TRACE\ntask_id\thash\n1\tab/cd\n")).toEqual({ alive: true, exitCode: undefined, trace: "task_id\thash\n1\tab/cd\n" });
    expect(parsePoll("@@ALIVE 0\n@@EXIT 1\n@@TRACE\n")).toEqual({ alive: false, exitCode: 1, trace: "" });
    expect(parseSize("@@KB 12\n")).toBe(12 * 1024);
    expect(parseSize("@@KB -1\n")).toBe(-1);
  });

  it("writes scripts a POSIX shell accepts", () => {
    const scripts = [
      launchScript({ ...host, setup: "module load nextflow" }, { launchDir: "/s/p/wf", attemptDir: "/s/r/1", args: ["run", ".", "-name", "it's"] }),
      pollScript({ attemptDir: "/s/r/1", pid: 12, pidStart: "Mon Nov  2 01:00:00 2026" }),
      cancelScript({ pid: 12, pidStart: "x" }),
      packScript("/s/r/1", ["trace.tsv", ".nextflow/history"]),
    ];
    for (const script of scripts) expect(() => execFileSync("sh", ["-n"], { input: script })).not.toThrow();
    expect(scripts[0]).toContain("module load nextflow\n");
    expect(scripts[0]).toContain("setsid");
  });
});
