import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskRecord } from "@/features/runs/types";
import { StudioStore, type StoredExecution } from "@/lib/server/database";
import { planCleanup, taskDirectory } from "./plan";
import { cleanSession, storageReport } from "./storage";
import { directorySize } from "./usage";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "studio-storage-"));
  dirs.push(root);
  const work = join(root, "work");
  const db = new StudioStore(join(root, "studio.sqlite"));
  const run = (id: string, session: string | undefined, status = "succeeded", submittedAt = "2026-11-01T00:00:00Z"): StoredExecution => ({
    lineageId: id, projectDir: join(root, "pipelines", "wf"), attemptDir: join(root, "executions", id, "attempts", id), sessionId: session,
    detail: { id, runName: `run_${id}`, workflowId: "wf", workflowName: "PBMC", status, submittedAt, launch: { workDir: work, executor: "local" }, progress: {}, params: {} },
  }) as unknown as StoredExecution;
  const task = (hash: string): TaskRecord => ({ hash, nodeId: "n", process: "P", name: "P", status: "completed", cpus: 1, workdir: join(work, hash.slice(0, 2), hash.slice(3) + "0000000000") });
  const makeDir = (t: TaskRecord, bytes: number) => { mkdirSync(t.workdir, { recursive: true }); writeFileSync(join(t.workdir, "out.bin"), Buffer.alloc(bytes)); };
  return { root, work, db, run, task, makeDir };
}

describe("disk cleanup by Nextflow session", () => {
  it("only accepts task directories inside the work root", () => {
    expect(taskDirectory("/w", "/w/ab/cdef0123")).toBe("/w/ab/cdef0123");
    expect(taskDirectory("/w", "/w/../etc")).toBeUndefined();
    expect(taskDirectory("/w", "/w/ab")).toBeUndefined();
    expect(taskDirectory("/w", "/other/ab/cdef0123")).toBeUndefined();
  });

  it("removes a session's work, keeps other sessions, and marks every run of the session", async () => {
    const { db, run, task, makeDir, root } = fixture();
    const first = run("a", "11111111-1111-1111-1111-111111111111");
    const resumed = run("b", "11111111-1111-1111-1111-111111111111", "succeeded", "2026-11-02T00:00:00Z");
    const other = run("c", "22222222-2222-2222-2222-222222222222");
    for (const r of [first, resumed, other]) db.insertRun(r);
    const [t1, t2, t3] = [task("aa/bbbbbb"), task("cc/dddddd"), task("ee/ffffff")];
    db.putTask("a", t1); db.putTask("b", t1); db.putTask("b", t2); db.putTask("c", t3);
    makeDir(t1, 1000); makeDir(t2, 2000); makeDir(t3, 4000);
    // A published result is a hard link into the work directory: removing the work copy frees nothing.
    mkdirSync(join(first.attemptDir, "results"), { recursive: true });
    linkSync(join(t2.workdir, "out.bin"), join(first.attemptDir, "results", "out.bin"));
    mkdirSync(join(root, "pipelines", "wf", ".nextflow", "cache", first.sessionId!), { recursive: true });

    const report = await storageReport(db);
    const session = report.sessions.find((s) => s.sessionId === first.sessionId)!;
    expect(session.runs.map((r) => r.id)).toEqual(["a", "b"]);
    expect(session).toMatchObject({ workDirs: 2, workBytes: 3000, reclaimableBytes: 1000 });

    const plan = planCleanup(first.sessionId!, db.runs(true), (id) => db.tasks(id));
    expect(plan.directories).toEqual([t1.workdir, t2.workdir].sort());

    const result = await cleanSession(first.sessionId!, {}, db);
    expect(result).toMatchObject({ removedDirs: 2, freedBytes: 1000, affectedRuns: ["a", "b"] });
    expect(existsSync(t1.workdir) || existsSync(t2.workdir)).toBe(false);
    expect(existsSync(t3.workdir)).toBe(true);
    expect(existsSync(join(first.attemptDir, "results", "out.bin"))).toBe(true);
    expect(existsSync(join(root, "pipelines", "wf", ".nextflow", "cache", first.sessionId!))).toBe(false);
    expect(db.run("b", true)?.detail.workCleanedAt).toBeDefined();
    expect(db.run("c", true)?.detail.workCleanedAt).toBeUndefined();
    db.close();
  });

  it("refuses while a run of the session is active", async () => {
    const { db, run } = fixture();
    db.insertRun(run("x", "33333333-3333-3333-3333-333333333333", "running"));
    await expect(cleanSession("33333333-3333-3333-3333-333333333333", {}, db)).rejects.toThrow(/还没有结束/);
    db.close();
  });

  it("counts reclaimable bytes per link count", async () => {
    const { root } = fixture();
    mkdirSync(join(root, "d"));
    writeFileSync(join(root, "d", "a"), Buffer.alloc(10));
    linkSync(join(root, "d", "a"), join(root, "link"));
    writeFileSync(join(root, "d", "b"), Buffer.alloc(5));
    expect(await directorySize(join(root, "d"))).toMatchObject({ bytes: 15, reclaimable: 5, files: 2 });
  });
});
