import { afterEach, describe, expect, it } from "vitest";
import { defaultLaunchConfig } from "@/features/project/launch";
import { qcDemoWorkflow } from "@/features/workflow/qc-demo";
import { StudioStore, type StoredExecution } from "@/lib/server/database";
import { emptyProgress } from "./service";
import { ingestEvent, taskFromTrace } from "./tasks";

const databases: StudioStore[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function setup() {
  const db = new StudioStore(":memory:"); databases.push(db);
  const workflow = qcDemoWorkflow();
  const run: StoredExecution = {
    lineageId: "run", projectDir: "/project", attemptDir: "/attempt",
    detail: { id: "run", runName: "run", workflowId: workflow.id, workflowName: workflow.name, status: "running", executor: "local", profile: "docker", submittedAt: new Date().toISOString(), progress: emptyProgress(), command: "nextflow run .", launch: defaultLaunchConfig(), params: workflow.params, runConfig: "", project: { name: "studio/qcsmoke", files: [], components: [] }, workflow },
  };
  db.insertRun(run);
  return { db, run };
}
const trace = { task_id: 1, attempt: 1, hash: "aa/123456", process: "QCSMOKE:FASTQC", name: "FASTQC (SINGLE)", tag: "SINGLE", cpus: 2, workdir: "/work/aa/123456" };

describe("Nextflow task ingestion", () => {
  it("maps real process aliases to canvas nodes and preserves raw metrics", () => {
    const { run } = setup();
    const task = taskFromTrace(run, { ...trace, status: "COMPLETED", exit: 0, peak_rss: 1048576, duration: 500, submit: 1700000000000 });
    expect(task).toMatchObject({ id: "1:1", nodeId: "fastqc", status: "completed", exitStatus: 0, peakRss: 1048576, durationMs: 500, submittedAt: "2023-11-14T22:13:20.000Z" });
  });
  it("deduplicates events and prevents late start events from reviving completed tasks", () => {
    const { db } = setup();
    const completed = { event: "process_completed", runId: "session", trace: { ...trace, status: "COMPLETED", exit: 0 } };
    ingestEvent(db, "run", completed);
    ingestEvent(db, "run", completed);
    ingestEvent(db, "run", { event: "process_started", trace: { ...trace, status: "RUNNING" } });
    expect(db.tasks("run")).toHaveLength(1);
    expect(db.tasks("run")[0].status).toBe("completed");
    expect(db.run("run")?.detail.progress).toMatchObject({ total: 1, completed: 1, running: 0 });
    expect(db.run("run")?.sessionId).toBe("session");
    expect(db.db.prepare("SELECT count(*) AS n FROM events").get()?.n).toBe(2);
  });
  it("keeps retry history while progress counts the latest attempt", () => {
    const { db } = setup();
    ingestEvent(db, "run", { event: "process_completed", trace: { ...trace, status: "FAILED", exit: 137 } });
    ingestEvent(db, "run", { event: "process_completed", trace: { ...trace, task_id: 2, attempt: 2, hash: "bb/234567", status: "COMPLETED", exit: 0 } });
    expect(db.tasks("run")).toHaveLength(2);
    expect(db.run("run")?.detail.progress).toMatchObject({ total: 1, completed: 1, failed: 0 });
  });
  it("does not collapse distinct first attempts that share a scatter tag", () => {
    const { db } = setup();
    for (const taskId of [1, 2]) ingestEvent(db, "run", { event: "process_completed", trace: { ...trace, task_id: taskId, status: "COMPLETED", exit: 0 } });
    expect(db.run("run")?.detail.progress).toMatchObject({ total: 2, completed: 2 });
  });
});
