import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModuleLibraryCopy } from "@/features/notebook/library-copy";
import type { NotebookDoc, NotebookRevision, TryRunRecord } from "@/features/notebook/types";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import { commitWorkflowPut, type WorkflowPutResult } from "@/features/workflow/revision";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";
import { DataVersionError, migrateDataLayout, migrateDatabase, migrateModuleLibrary, type MigrationResult } from "./migrations";
import { dataDirectory, moduleLibraryDirectory } from "./paths";

// Runtime data is intentionally outside the deployable Next.js source tree.
export { dataDirectory };

export interface StoredExecution {
  detail: RunDetail;
  projectDir: string;
  attemptDir: string;
  lineageId: string;
  sessionId?: string;
  pid?: number;
  pidStart?: string;
  owner?: string;
  /** Weblog URL parts the Nextflow head was started with; a restarted runner listens there again. */
  eventPort?: number;
  eventToken?: string;
  cancelRequested?: boolean;
  resumeFrom?: string;
}

/** All mutations are synchronous transactions so web and runner cannot lose updates. */
export class StudioStore {
  readonly db: DatabaseSync;
  /** Module library folder for this database. An in-memory database has none. */
  readonly moduleLibrary?: string;
  /** What opening this database upgraded, for the setup page and diagnostics. */
  readonly migration: MigrationResult;
  constructor(path = join(dataDirectory(), "studio.sqlite")) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
      this.moduleLibrary = moduleLibraryDirectory(undefined, dirname(path));
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000;");
    try {
      if (path !== ":memory:") this.db.exec("PRAGMA journal_mode=WAL;");
      const appVersion = process.env.NEXTFLOW_STUDIO_APP_VERSION;
      this.migration = migrateDatabase(this.db, path === ":memory:" ? {} : { backupDir: join(dirname(path), "backups") });
      if (path !== ":memory:") {
        migrateDataLayout(dirname(path), appVersion);
        if (this.moduleLibrary) {
          // A shared library can be read-only (a team checkout); reading it does not need the marker.
          try { migrateModuleLibrary(this.moduleLibrary, appVersion); }
          catch (error) { if (error instanceof DataVersionError) throw error; console.warn(`模块库版本标记未写入：${error instanceof Error ? error.message : String(error)}`); }
        }
      }
      if (appVersion) this.setMeta("appVersion", appVersion);
    } catch (error) { this.db.close(); throw error; }
  }
  meta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? String(row.value) : undefined;
  }
  setMeta(key: string, value: string) { this.db.prepare("INSERT INTO meta(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); }
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
  runtime(): { owner: string; pid: number; heartbeat: number; eventPort?: number; versions?: Record<string, string>; resources?: { architecture: string; cpus: number; memoryBytes: number }; error?: string } | undefined {
    const row = this.db.prepare("SELECT data FROM runtime WHERE id=1").get();
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  setRuntime(value: NonNullable<ReturnType<StudioStore["runtime"]>>) { this.db.prepare("INSERT INTO runtime VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(value)); }
  notebooks(): NotebookDoc[] {
    return this.db.prepare("SELECT data FROM notebooks").all().map((row) => JSON.parse(String(row.data)) as NotebookDoc).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  notebook(id: string): NotebookDoc | undefined {
    const row = this.db.prepare("SELECT data FROM notebooks WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as NotebookDoc : undefined;
  }
  notebookCount(): number {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM notebooks").get()?.n ?? 0);
  }
  /** Writes the document. Cell edits bump `rev` and store a snapshot. */
  saveNotebook(doc: NotebookDoc): NotebookDoc {
    return this.transaction(() => {
      const prev = this.notebook(doc.id);
      const cellsChanged = !prev || JSON.stringify(prev.cells) !== JSON.stringify(doc.cells);
      const next: NotebookDoc = {
        ...doc,
        rev: prev ? (cellsChanged ? prev.rev + 1 : prev.rev) : Math.max(1, doc.rev || 1),
        createdAt: prev?.createdAt ?? doc.createdAt,
        updatedAt: new Date().toISOString(),
      };
      this.db.prepare("INSERT INTO notebooks(id, updated, data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, data=excluded.data").run(next.id, next.updatedAt, JSON.stringify(next));
      if (!prev || cellsChanged) this.saveRevision({ notebookId: next.id, rev: next.rev, cells: next.cells, savedAt: next.updatedAt });
      return next;
    });
  }
  /** Inserts a demo notebook without bumping the supplied revision. */
  insertNotebookSnapshot(doc: NotebookDoc) {
    this.db.prepare("INSERT INTO notebooks(id, updated, data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, data=excluded.data").run(doc.id, doc.updatedAt, JSON.stringify(doc));
  }
  saveRevision(revision: NotebookRevision) {
    this.db.prepare("INSERT INTO notebook_revisions(notebook_id, rev, data) VALUES (?,?,?) ON CONFLICT(notebook_id, rev) DO UPDATE SET data=excluded.data").run(revision.notebookId, revision.rev, JSON.stringify(revision));
  }
  revisions(notebookId: string): NotebookRevision[] {
    return this.db.prepare("SELECT data FROM notebook_revisions WHERE notebook_id=? ORDER BY rev").all(notebookId).map((row) => JSON.parse(String(row.data)) as NotebookRevision);
  }
  revision(notebookId: string, rev: number): NotebookRevision | undefined {
    const row = this.db.prepare("SELECT data FROM notebook_revisions WHERE notebook_id=? AND rev=?").get(notebookId, rev);
    return row ? JSON.parse(String(row.data)) as NotebookRevision : undefined;
  }
  scriptModules(): ModuleDef[] {
    return this.db.prepare("SELECT data FROM script_modules").all().map((row) => JSON.parse(String(row.data)) as ModuleDef);
  }
  scriptModule(id: string): ModuleDef | undefined {
    const row = this.db.prepare("SELECT data FROM script_modules WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as ModuleDef : undefined;
  }
  saveScriptModule(mod: ModuleDef) {
    this.db.prepare("INSERT INTO script_modules(id, data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(mod.id, JSON.stringify(mod));
  }
  libraryCopies(): ModuleLibraryCopy[] {
    return this.db.prepare("SELECT data FROM module_library").all().map((row) => JSON.parse(String(row.data)) as ModuleLibraryCopy);
  }
  libraryCopy(moduleId: string): ModuleLibraryCopy | undefined {
    const row = this.db.prepare("SELECT data FROM module_library WHERE module_id=?").get(moduleId);
    return row ? JSON.parse(String(row.data)) as ModuleLibraryCopy : undefined;
  }
  saveLibraryCopy(copy: ModuleLibraryCopy) {
    this.db.prepare("INSERT INTO module_library(module_id, data) VALUES (?,?) ON CONFLICT(module_id) DO UPDATE SET data=excluded.data").run(copy.moduleId, JSON.stringify(copy));
  }
  /** Raw notebook JSON, for checks that a publish left the source row untouched. */
  notebookJson(id: string): string | undefined {
    const row = this.db.prepare("SELECT data FROM notebooks WHERE id=?").get(id);
    return row ? String(row.data) : undefined;
  }
  tryRun(notebookId: string, rev: number): TryRunRecord | undefined {
    const row = this.db.prepare("SELECT data FROM notebook_try_runs WHERE notebook_id=? AND rev=?").get(notebookId, rev);
    return row ? JSON.parse(String(row.data)) as TryRunRecord : undefined;
  }
  saveTryRun(record: TryRunRecord) {
    this.db.prepare("INSERT INTO notebook_try_runs(notebook_id, rev, data) VALUES (?,?,?) ON CONFLICT(notebook_id, rev) DO UPDATE SET data=excluded.data").run(record.notebookId, record.rev, JSON.stringify(record));
  }
  close() { this.db.close(); }
}

const globalStore = globalThis as typeof globalThis & { studioStore?: StudioStore };
export const store = () => globalStore.studioStore ??= new StudioStore();
