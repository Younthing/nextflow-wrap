import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import { commitWorkflowPut, type WorkflowPutResult } from "@/features/workflow/revision";
import type { WorkflowDoc } from "@/features/workflow/types";

// Runtime data is intentionally outside the deployable Next.js source tree.
export const dataDirectory = () => resolve(/* turbopackIgnore: true */ process.env.NEXTFLOW_STUDIO_DATA_DIR ?? join(homedir(), ".local/share/nextflow-studio"));

export interface StoredExecution {
  detail: RunDetail;
  projectDir: string;
  attemptDir: string;
  lineageId: string;
  sessionId?: string;
  pid?: number;
  pidStart?: string;
  owner?: string;
  cancelRequested?: boolean;
  resumeFrom?: string;
}

/** All mutations are synchronous transactions so web and runner cannot lose updates. */
export class StudioStore {
  readonly db: DatabaseSync;
  constructor(path = join(dataDirectory(), "studio.sqlite")) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
    if (version > 1) { this.db.close(); throw new Error(`不支持的数据库版本：${version}`); }
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, idempotency TEXT UNIQUE, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tasks (run_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,id));
      CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,digest));
      CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  workflows(): WorkflowDoc[] {
    return this.db.prepare("SELECT data FROM workflows").all().map((r) => JSON.parse(String(r.data)) as WorkflowDoc).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  workflow(id: string): WorkflowDoc | undefined {
    const row = this.db.prepare("SELECT data FROM workflows WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as WorkflowDoc : undefined;
  }
  saveWorkflow(doc: WorkflowDoc) { this.db.prepare("INSERT INTO workflows VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(doc.id, JSON.stringify(doc)); }
  /** Compare the stored revision and write the next document under one lock. */
  putWorkflow(incoming: WorkflowDoc): WorkflowPutResult {
    return this.transaction(() => {
      const result = commitWorkflowPut(this.workflow(incoming.id), incoming);
      if (result.status === "ok") this.saveWorkflow(result.doc);
      return result;
    });
  }
  deleteWorkflow(id: string) { this.db.prepare("DELETE FROM workflows WHERE id=?").run(id); }
  runs(includeDeleted = false): StoredExecution[] {
    return this.db.prepare(`SELECT data FROM runs ${includeDeleted ? "" : "WHERE deleted=0"} ORDER BY created DESC`).all().map((r) => JSON.parse(String(r.data)) as StoredExecution);
  }
  run(id: string, includeDeleted = false): StoredExecution | undefined {
    const row = this.db.prepare(`SELECT data FROM runs WHERE id=? ${includeDeleted ? "" : "AND deleted=0"}`).get(id);
    return row ? JSON.parse(String(row.data)) as StoredExecution : undefined;
  }
  byIdempotency(key: string): StoredExecution | undefined {
    const row = this.db.prepare("SELECT data FROM runs WHERE idempotency=?").get(key);
    return row ? JSON.parse(String(row.data)) as StoredExecution : undefined;
  }
  insertRun(run: StoredExecution, key?: string) {
    this.db.prepare("INSERT INTO runs(id,status,created,data,idempotency) VALUES (?,?,?,?,?)").run(run.detail.id, run.detail.status, run.detail.submittedAt, JSON.stringify(run), key ?? null);
  }
  updateRun(id: string, update: (run: StoredExecution) => void) {
    return this.transaction(() => {
      const run = this.run(id, true);
      if (!run) throw new Error("运行不存在");
      update(run);
      this.db.prepare("UPDATE runs SET status=?,data=? WHERE id=?").run(run.detail.status, JSON.stringify(run), id);
      return run;
    });
  }
  deleteRun(id: string) { this.db.prepare("UPDATE runs SET deleted=1 WHERE id=?").run(id); }
  tasks(id: string): TaskRecord[] {
    return this.db.prepare("SELECT data FROM tasks WHERE run_id=? ORDER BY id").all(id).map((r) => JSON.parse(String(r.data)) as TaskRecord);
  }
  putTask(runId: string, task: TaskRecord) {
    this.db.prepare("INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(run_id,id) DO UPDATE SET data=excluded.data").run(runId, task.id ?? task.hash, JSON.stringify(task));
  }
  event(runId: string, digest: string, event: unknown): boolean {
    return this.db.prepare("INSERT OR IGNORE INTO events VALUES (?,?,?)").run(runId, digest, JSON.stringify(event)).changes === 1;
  }
  runtime(): { owner: string; pid: number; heartbeat: number; versions?: Record<string, string>; resources?: { architecture: string; cpus: number; memoryBytes: number }; error?: string } | undefined {
    const row = this.db.prepare("SELECT data FROM runtime WHERE id=1").get();
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  setRuntime(value: NonNullable<ReturnType<StudioStore["runtime"]>>) { this.db.prepare("INSERT INTO runtime VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(value)); }
  close() { this.db.close(); }
}

const globalStore = globalThis as typeof globalThis & { studioStore?: StudioStore };
export const store = () => globalStore.studioStore ??= new StudioStore();
