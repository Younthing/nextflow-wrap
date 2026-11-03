import type { DatabaseSync } from "node:sqlite";

/**
 * The database schema. There are no migrations: an empty file gets these tables, a file with this
 * `PRAGMA user_version` is used as is, and any other file is refused with a message to start from a fresh data
 * directory.
 */
export const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, idempotency TEXT UNIQUE, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS runs_created ON runs(created);
  CREATE TABLE IF NOT EXISTS tasks (run_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,id));
  CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,digest));
  CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notebooks (id TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notebook_revisions (notebook_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(notebook_id, rev));
  CREATE TABLE IF NOT EXISTS script_modules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notebook_try_runs (notebook_id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(notebook_id, rev));
  CREATE TABLE IF NOT EXISTS module_library (module_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, opened TEXT NOT NULL, data TEXT NOT NULL);
`;

export class DataVersionError extends Error {}

const userVersion = (db: DatabaseSync) => Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
const tableCount = (db: DatabaseSync) => Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n ?? 0);

/** Creates the schema in an empty database and refuses one written by another version of the app. */
export function openSchema(db: DatabaseSync, path: string) {
  db.exec("BEGIN IMMEDIATE");
  try {
    // The web server and the runner open the same file at the same time; the lock makes one of them create it.
    const version = userVersion(db);
    if (version === 0 && tableCount(db) > 0) throw new DataVersionError(`${path} 来自旧版本的应用，删除数据目录后重新启动`);
    if (version !== 0 && version !== SCHEMA_VERSION) throw new DataVersionError(`${path} 的格式版本 ${version} 与这个应用（${SCHEMA_VERSION}）不同，删除数据目录后重新启动`);
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
