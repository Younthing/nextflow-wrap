import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Versioned local data. Beta users upgrade the app in place, so every format the app writes carries a version
 * and is upgraded by an ordered list of steps:
 *
 * - `studio.sqlite`: `PRAGMA user_version` plus `SCHEMA_MIGRATIONS`. Before upgrading an existing file the
 *   database is copied to `backups/` with `VACUUM INTO`.
 * - The data directory and the module library: a small `layout.json` / `library.json` with `formatVersion`,
 *   upgraded by `LAYOUT_MIGRATIONS` / `LIBRARY_MIGRATIONS`.
 *
 * A file written by a newer app is refused instead of being read wrongly, so a downgrade never loses data.
 * Other features that keep their own files (the workspace's `studio.json`) carry their own format version.
 */
export interface SchemaMigration {
  version: number;
  description: string;
  up: (db: DatabaseSync) => void;
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    description: "workflows, runs, tasks, events and runner state",
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, idempotency TEXT UNIQUE, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tasks (run_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,id));
      CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,digest));
      CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    `),
  },
  {
    version: 2,
    description: "notebooks, revisions, script modules and try-runs",
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (id TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notebook_revisions (notebook_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(notebook_id, rev));
      CREATE TABLE IF NOT EXISTS script_modules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notebook_try_runs (notebook_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(notebook_id, rev));
    `),
  },
  {
    version: 3,
    description: "module library copies",
    up: (db) => db.exec("CREATE TABLE IF NOT EXISTS module_library (module_id TEXT PRIMARY KEY, data TEXT NOT NULL);"),
  },
  {
    version: 4,
    description: "app metadata and a run index",
    up: (db) => {
      // Versions 1–3 created every table on each open regardless of user_version, so a file stamped 2 or 3
      // may still lack some. Their steps are idempotent; replay them before relying on those tables.
      for (const step of SCHEMA_MIGRATIONS.slice(0, 3)) step.up(db);
      db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_created ON runs(created);
    `);
    },
  },
];

export const SCHEMA_VERSION = SCHEMA_MIGRATIONS.at(-1)!.version;

export class DataVersionError extends Error {}

export interface MigrationResult {
  from: number;
  to: number;
  applied: number[];
  backup?: string;
}

const userVersion = (db: DatabaseSync) => Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);

/**
 * Bring a database to `SCHEMA_VERSION`. Each step and its version bump commit together, so a crash leaves the
 * database at the last finished step. `backupDir` receives a copy of a non-empty database before the first step.
 */
export function migrateDatabase(db: DatabaseSync, options: { backupDir?: string; migrations?: readonly SchemaMigration[]; now?: () => Date } = {}): MigrationResult {
  const migrations = options.migrations ?? SCHEMA_MIGRATIONS;
  const target = migrations.at(-1)?.version ?? 0;
  const from = userVersion(db);
  if (from > target) throw new DataVersionError(`数据库版本 ${from} 比这个版本的应用新（最高支持 ${target}），请升级应用后再打开`);
  const pending = migrations.filter((step) => step.version > from);
  if (!pending.length) return { from, to: from, applied: [] };
  let backup: string | undefined;
  const hasData = from > 0 || Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n ?? 0) > 0;
  if (options.backupDir && hasData) {
    mkdirSync(options.backupDir, { recursive: true });
    const stamp = (options.now?.() ?? new Date()).toISOString().replaceAll(":", "-").replace(/\..+$/, "");
    backup = join(options.backupDir, `studio-v${from}-${stamp}.sqlite`);
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
  }
  for (const step of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      // Another process (web and runner open the same file) may have finished this step meanwhile.
      if (userVersion(db) >= step.version) { db.exec("COMMIT"); continue; }
      step.up(db);
      db.exec(`PRAGMA user_version=${step.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`数据库升级到版本 ${step.version}（${step.description}）失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { from, to: target, applied: pending.map((step) => step.version), backup };
}

/** A directory whose layout is described by a `formatVersion` in a small JSON file. */
export interface DirectoryMigration {
  version: number;
  description: string;
  up: (root: string) => void;
}

/**
 * Data directory layout.
 * 1: `studio.sqlite`, `pipelines/<workflow>/`, shared `work/`, `executions/<lineage>/attempts/<run>/`, `library/modules/`.
 */
export const LAYOUT_MIGRATIONS: readonly DirectoryMigration[] = [
  { version: 1, description: "per-workflow launch directories, a shared work directory and execution records", up: () => {} },
];

/** Module library layout. 1: `<namespace>/<name>/<version>/` with `main.nf`, `meta.yml`, `module.json`. */
export const LIBRARY_MIGRATIONS: readonly DirectoryMigration[] = [
  { version: 1, description: "one folder per published module version", up: () => {} },
];

interface VersionFile { formatVersion: number; updatedAt: string; appVersion?: string }

function readVersionFile(path: string): VersionFile | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as VersionFile; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DataVersionError(`无法读取 ${path}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeVersionFile(path: string, value: VersionFile) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

/**
 * Upgrade a directory described by `<root>/<file>`. A directory without the file is the first layout
 * (everything written before versioning existed), so it is stamped without running any step but the first.
 */
export function migrateDirectory(root: string, file: string, migrations: readonly DirectoryMigration[], appVersion?: string): MigrationResult {
  const path = join(root, file);
  const target = migrations.at(-1)?.version ?? 0;
  const current = readVersionFile(path);
  const from = current?.formatVersion ?? 0;
  if (from > target) throw new DataVersionError(`${path} 的格式版本 ${from} 比这个版本的应用新（最高支持 ${target}），请升级应用`);
  const pending = migrations.filter((step) => step.version > from);
  for (const step of pending) {
    step.up(root);
    writeVersionFile(path, { formatVersion: step.version, updatedAt: new Date().toISOString(), ...(appVersion ? { appVersion } : {}) });
  }
  return { from, to: Math.max(from, target), applied: pending.map((step) => step.version) };
}

export const migrateDataLayout = (dataDir: string, appVersion?: string) => migrateDirectory(dataDir, "layout.json", LAYOUT_MIGRATIONS, appVersion);
export const migrateModuleLibrary = (libraryDir: string, appVersion?: string) => migrateDirectory(libraryDir, "library.json", LIBRARY_MIGRATIONS, appVersion);
