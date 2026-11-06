import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ProjectDocuments } from "@/features/workspace/server/project-documents";
import { ProjectFileError } from "@/features/workspace/server/project-files";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModuleLibraryCopy } from "@/features/notebook/library-copy";
import type { NotebookDoc, NotebookRevision, TryRunRecord } from "@/features/notebook/types";
import type { RunDetail, TaskRecord } from "@/features/runs/types";
import type { Project } from "@/features/workspace/types";
import { commitWorkflowPut, type WorkflowPutResult } from "@/features/workflow/revision";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";
import { openSchema } from "./schema";
import { dataDirectory, workspaceDirectory } from "./paths";

// Runtime data is intentionally outside the deployable Next.js source tree.
export { dataDirectory };

export interface StoredExecution {
  detail: RunDetail;
  projectRoot?: string;
  inputParams?: Record<string, unknown>;
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
  /** Example project folder (the default workspace). An in-memory database has none. */
  readonly workspace?: string;
  /** Folder of the database file. An in-memory database has none. */
  readonly dataDir?: string;
  readonly documents?: ProjectDocuments;
  constructor(path = join(dataDirectory(), "workspace-registry.sqlite"), readonly projectRoot?: string, readonly projectHandle?: string) {
    if (projectRoot && projectHandle) this.documents = new ProjectDocuments(projectRoot, projectHandle);
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
      this.dataDir = dirname(path);
      this.workspace = workspaceDirectory(undefined, dirname(path));
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000;");
    try {
      if (path !== ":memory:") this.db.exec("PRAGMA journal_mode=WAL;");
      openSchema(this.db, path);
      if (this.documents && existsSync(join(this.documents.files.root, "runs"))) {
        for (const entry of readdirSync(join(this.documents.files.root, "runs"), { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          const file = join(this.documents.files.root, "runs", entry.name, "run.json");
          if (!existsSync(file)) continue;
          const run = JSON.parse(readFileSync(file, "utf8")) as StoredExecution;
          if (!run.detail?.id || this.db.prepare("SELECT id FROM runs WHERE id=?").get(run.detail.id)) continue;
          const moved = run.projectRoot !== this.documents.files.root;
          if (moved) {
            run.projectRoot = this.documents.files.root;
            run.attemptDir = join(run.projectRoot, "runs", run.detail.id);
            run.detail.params.outdir = join(run.attemptDir, "results");
            run.projectDir = join(run.projectRoot, ".studio/runtime/workflows", run.detail.workflowId);
            run.detail.workCleanedAt = new Date().toISOString();
            if (run.detail.status === "running" || run.detail.status === "submitted") {
              run.detail.status = "failed";
              run.detail.errorMessage = "项目位置已改变，原运行不能自动接管";
              delete run.pid;
            }
          }
          this.db.prepare("INSERT INTO runs(id,status,created,data) VALUES (?,?,?,?)").run(run.detail.id, run.detail.status, run.detail.submittedAt, JSON.stringify(run));
        }
      }
      const appVersion = process.env.NEXTFLOW_STUDIO_APP_VERSION;
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
    if (this.documents) return this.documents.list("workflow");
    return this.db.prepare("SELECT data FROM workflows").all().map((r) => JSON.parse(String(r.data)) as WorkflowDoc).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  workflow(id: string): WorkflowDoc | undefined {
    if (this.documents) return this.documents.get(id, "workflow");
    const row = this.db.prepare("SELECT data FROM workflows WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as WorkflowDoc : undefined;
  }
  saveWorkflow(doc: WorkflowDoc) {
    if (this.documents) return Object.assign(doc, this.documents.write(doc, "workflow")); this.db.prepare("INSERT INTO workflows VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(doc.id, JSON.stringify(doc)); }
  /** Compare the stored revision and write the next document under one lock. */
  putWorkflow(incoming: WorkflowDoc): WorkflowPutResult {
    return this.transaction(() => {
      const current = this.workflow(incoming.id);
      if (this.documents && current && incoming.fileVersion !== current.fileVersion) return { status: "stale" } as const;
      const result = commitWorkflowPut(current, incoming);
      if (result.status === "ok") this.saveWorkflow(result.doc);
      return result;
    });
  }
  deleteWorkflow(id: string) { if (this.documents) return this.documents.remove(id, "workflow"); this.db.prepare("DELETE FROM workflows WHERE id=?").run(id); }
  runs(includeDeleted = false): StoredExecution[] {
    if (this.dataDir && !this.projectRoot) return this.projectStores().flatMap((db) => db.runs(includeDeleted));
    return this.db.prepare(`SELECT data FROM runs ${includeDeleted ? "" : "WHERE deleted=0"} ORDER BY created DESC`).all().map((r) => JSON.parse(String(r.data)) as StoredExecution);
  }
  run(id: string, includeDeleted = false): StoredExecution | undefined {
    if (this.dataDir && !this.projectRoot) return this.projectStores().map((db) => db.run(id, includeDeleted)).find(Boolean);
    const row = this.db.prepare(`SELECT data FROM runs WHERE id=? ${includeDeleted ? "" : "AND deleted=0"}`).get(id);
    return row ? JSON.parse(String(row.data)) as StoredExecution : undefined;
  }
  byIdempotency(key: string): StoredExecution | undefined {
    const row = this.db.prepare("SELECT data FROM runs WHERE idempotency=?").get(key);
    return row ? JSON.parse(String(row.data)) as StoredExecution : undefined;
  }
  insertRun(run: StoredExecution, key?: string) {
    this.documents?.files.record(`runs/${run.detail.id}/run.json`, run);
    this.documents?.files.record(`runs/${run.detail.id}/snapshot/workflow.json`, run.detail.workflow);
    this.documents?.files.record(`runs/${run.detail.id}/snapshot/params.json`, { requested: run.inputParams, resolved: run.detail.params });
    this.documents?.files.record(`runs/${run.detail.id}/snapshot/modules.json`, this.scriptModules());
    this.db.prepare("INSERT INTO runs(id,status,created,data,idempotency) VALUES (?,?,?,?,?)").run(run.detail.id, run.detail.status, run.detail.submittedAt, JSON.stringify(run), key ?? null);
  }
  updateRun(id: string, update: (run: StoredExecution) => void): StoredExecution {
    if (this.dataDir && !this.projectRoot) { const db = this.projectStores().find((candidate) => candidate.run(id, true)); if (!db) throw new Error("运行不存在"); return db.updateRun(id, update); }
    return this.transaction(() => {
      const run = this.run(id, true);
      if (!run) throw new Error("运行不存在");
      update(run);
      this.db.prepare("UPDATE runs SET status=?,data=? WHERE id=?").run(run.detail.status, JSON.stringify(run), id);
      this.documents?.files.record(`runs/${id}/run.json`, run);
      return run;
    });
  }
  deleteRun(id: string) { this.db.prepare("UPDATE runs SET deleted=1 WHERE id=?").run(id); }
  tasks(id: string): TaskRecord[] {
    if (this.dataDir && !this.projectRoot) return this.projectStores().find((db) => db.run(id, true))?.tasks(id) ?? [];
    return this.db.prepare("SELECT data FROM tasks WHERE run_id=? ORDER BY id").all(id).map((r) => JSON.parse(String(r.data)) as TaskRecord);
  }
  putTask(runId: string, task: TaskRecord): void {
    if (this.dataDir && !this.projectRoot) { this.projectStores().find((db) => db.run(runId, true))?.putTask(runId, task); return; }
    this.db.prepare("INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(run_id,id) DO UPDATE SET data=excluded.data").run(runId, task.id ?? task.hash, JSON.stringify(task));
  }
  event(runId: string, digest: string, event: unknown): boolean {
    if (this.dataDir && !this.projectRoot) return this.projectStores().find((db) => db.run(runId, true))?.event(runId, digest, event) ?? false;
    return this.db.prepare("INSERT OR IGNORE INTO events VALUES (?,?,?)").run(runId, digest, JSON.stringify(event)).changes === 1;
  }
  runtime(): { owner: string; pid: number; heartbeat: number; eventPort?: number; versions?: Record<string, string>; resources?: { architecture: string; cpus: number; memoryBytes: number }; error?: string } | undefined {
    if (this.projectRoot) return registryStore().runtime();
    const row = this.db.prepare("SELECT data FROM runtime WHERE id=1").get();
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  setRuntime(value: NonNullable<ReturnType<StudioStore["runtime"]>>) { this.db.prepare("INSERT INTO runtime VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(value)); }
  notebooks(): NotebookDoc[] {
    if (this.documents) return this.documents.list("notebook");
    return this.db.prepare("SELECT data FROM notebooks").all().map((row) => JSON.parse(String(row.data)) as NotebookDoc).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  notebook(id: string): NotebookDoc | undefined {
    if (this.documents) return this.documents.get(id, "notebook");
    const row = this.db.prepare("SELECT data FROM notebooks WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as NotebookDoc : undefined;
  }
  /** Removes the notebook. Its revisions and try-run receipts stay, for modules published from it. */
  deleteNotebook(id: string) { if (this.documents) return this.documents.remove(id, "notebook"); this.db.prepare("DELETE FROM notebooks WHERE id=?").run(id); }
  notebookCount(): number {
    if (this.documents) return this.notebooks().length;
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM notebooks").get()?.n ?? 0);
  }
  /** Writes the document. Cell edits bump `rev` and store a snapshot. */
  saveNotebook(doc: NotebookDoc): NotebookDoc {
    if (this.documents) return this.documents.saveNotebook(doc);
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
    if (this.documents) { this.documents.saveNotebook(doc); return; }
    this.db.prepare("INSERT INTO notebooks(id, updated, data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, data=excluded.data").run(doc.id, doc.updatedAt, JSON.stringify(doc));
  }
  saveRevision(revision: NotebookRevision) {
    this.db.prepare("INSERT INTO notebook_revisions(notebook_id, rev, data) VALUES (?,?,?) ON CONFLICT(notebook_id, rev) DO UPDATE SET data=excluded.data").run(revision.notebookId, revision.rev, JSON.stringify(revision));
  }
  revisions(notebookId: string): NotebookRevision[] {
    if (this.documents) return this.documents.revisions(notebookId);
    return this.db.prepare("SELECT data FROM notebook_revisions WHERE notebook_id=? ORDER BY rev").all(notebookId).map((row) => JSON.parse(String(row.data)) as NotebookRevision);
  }
  revision(notebookId: string, rev: number): NotebookRevision | undefined {
    if (this.documents) return this.revisions(notebookId).find((item) => item.rev === rev);
    const row = this.db.prepare("SELECT data FROM notebook_revisions WHERE notebook_id=? AND rev=?").get(notebookId, rev);
    return row ? JSON.parse(String(row.data)) as NotebookRevision : undefined;
  }
  scriptModules(): ModuleDef[] {
    if (this.documents) {
      const files = this.documents.files;
      if (!existsSync(files.resolve("modules"))) return [];
      return files.list("modules").filter((entry) => entry.directory && !entry.symlink).flatMap((entry) =>
        files.list(entry.path).filter((version) => version.directory && !version.symlink).flatMap((version) => {
          const path = `${version.path}/module.json`;
          return existsSync(files.resolve(path)) ? [JSON.parse(files.read(path).content) as ModuleDef] : [];
        }));
    }
    return this.db.prepare("SELECT data FROM script_modules").all().map((row) => JSON.parse(String(row.data)) as ModuleDef);
  }
  scriptModule(id: string): ModuleDef | undefined {
    if (this.documents) return this.scriptModules().find((mod) => mod.id === id);
    const row = this.db.prepare("SELECT data FROM script_modules WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as ModuleDef : undefined;
  }
  saveScriptModule(mod: ModuleDef) {
    if (this.documents) {
      const path = mod.id.startsWith("modules/") ? mod.id : `modules/${mod.path}/${mod.version ?? "v1"}/module.json`;
      const files = this.documents.files;
      files.write(path, `${JSON.stringify(mod, null, 2)}\n`, null);
      const folder = path.slice(0, -"module.json".length);
      if (mod.script) files.write(`${folder}script.${mod.command?.endsWith(".R") ? "R" : "py"}`, mod.script, null);
      if (mod.environmentYml) files.write(`${folder}environment.yml`, mod.environmentYml, null);
      return;
    }
    this.db.prepare("INSERT INTO script_modules(id, data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(mod.id, JSON.stringify(mod));
  }
  libraryCopies(): ModuleLibraryCopy[] {
    if (this.documents) return this.scriptModules().flatMap((mod) => { const copy = this.libraryCopy(mod.id); return copy ? [copy] : []; });
    return this.db.prepare("SELECT data FROM module_library").all().map((row) => JSON.parse(String(row.data)) as ModuleLibraryCopy);
  }
  libraryCopy(moduleId: string): ModuleLibraryCopy | undefined {
    if (this.documents) {
      const mod = this.scriptModule(moduleId);
      if (!mod) return undefined;
      const path = `${moduleId.slice(0, -"module.json".length)}library.json`;
      return existsSync(this.documents.files.resolve(path)) ? JSON.parse(this.documents.files.read(path).content) : undefined;
    }
    const row = this.db.prepare("SELECT data FROM module_library WHERE module_id=?").get(moduleId);
    return row ? JSON.parse(String(row.data)) as ModuleLibraryCopy : undefined;
  }
  saveLibraryCopy(copy: ModuleLibraryCopy) {
    if (this.documents) { this.documents.files.record(`${copy.moduleId.slice(0, -"module.json".length)}library.json`, copy); return; }
    this.db.prepare("INSERT INTO module_library(module_id, data) VALUES (?,?) ON CONFLICT(module_id) DO UPDATE SET data=excluded.data").run(copy.moduleId, JSON.stringify(copy));
  }
  /** Raw notebook JSON, for checks that a publish left the source row untouched. */
  notebookJson(id: string): string | undefined {
    if (this.documents) { const doc = this.notebook(id); return doc ? JSON.stringify(doc) : undefined; }
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
  /** Recent projects, most recently opened first. */
  projects(): Project[] {
    if (this.projectRoot) return registryStore().projects();
    return this.db.prepare("SELECT data FROM projects ORDER BY opened DESC").all().map((row) => JSON.parse(String(row.data)) as Project);
  }
  project(id: string): Project | undefined {
    if (this.projectRoot) return registryStore().project(id);
    const row = this.db.prepare("SELECT data FROM projects WHERE id=?").get(id);
    return row ? JSON.parse(String(row.data)) as Project : undefined;
  }
  saveProject(project: Project) {
    this.db.prepare("INSERT INTO projects(id, opened, data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET opened=excluded.opened, data=excluded.data").run(project.id, project.openedAt, JSON.stringify(project));
  }
  deleteProject(id: string) { this.db.prepare("DELETE FROM projects WHERE id=?").run(id); }
  private projectStores(): StudioStore[] {
    return this.projects().filter((project) => existsSync(join(project.path, ".studio", "state.sqlite"))).map((project) => projectStore(project.id));
  }
  close() { this.db.close(); }
}

const globalStore = globalThis as typeof globalThis & { studioStore?: StudioStore };
export const registryStore = () => globalStore.studioStore ??= new StudioStore();
const scope = new AsyncLocalStorage<StudioStore>();
const projectStores = new Map<string, StudioStore>();
export const store = () => scope.getStore() ?? registryStore();
export function projectStore(handle: string): StudioStore {
  const project = registryStore().project(handle);
  if (!project || !existsSync(project.path)) throw new ProjectFileError(404, "项目目录不存在");
  let db = projectStores.get(handle);
  if (!db) {
    db = new StudioStore(join(project.path, ".studio", "state.sqlite"), project.path, handle);
    projectStores.set(handle, db);
  }
  return db;
}
export const withProject = <T>(handle: string, operation: () => T): T => scope.run(projectStore(handle), operation);
