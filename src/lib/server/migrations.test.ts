import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioStore } from "./database";
import { DataVersionError, migrateDatabase, migrateDirectory, SCHEMA_VERSION, type SchemaMigration } from "./migrations";

const directories: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "studio-migrate-")); directories.push(dir); return dir; };
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("migrateDatabase", () => {
  it("creates a fresh database at the latest version without a backup", () => {
    const db = new DatabaseSync(":memory:");
    const result = migrateDatabase(db, { backupDir: join(temp(), "backups") });
    expect(result).toMatchObject({ from: 0, to: SCHEMA_VERSION, backup: undefined });
    expect(Number(db.prepare("PRAGMA user_version").get()?.user_version)).toBe(SCHEMA_VERSION);
  });

  it("backs up an older database before upgrading and keeps its rows", () => {
    const dir = temp();
    const path = join(dir, "studio.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA user_version=3; CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
    legacy.prepare("INSERT INTO workflows VALUES (?,?)").run("wf", "{}");
    const result = migrateDatabase(legacy, { backupDir: join(dir, "backups"), now: () => new Date("2026-11-01T00:00:00Z") });
    expect(result.from).toBe(3);
    expect(result.applied).toEqual([4]);
    expect(result.backup && existsSync(result.backup)).toBe(true);
    const copy = new DatabaseSync(result.backup!);
    expect(Number(copy.prepare("PRAGMA user_version").get()?.user_version)).toBe(3);
    expect(copy.prepare("SELECT id FROM workflows").get()?.id).toBe("wf");
    copy.close();
    expect(legacy.prepare("SELECT id FROM workflows").get()?.id).toBe("wf");
    legacy.close();
  });

  it("refuses a database written by a newer app", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`);
    expect(() => migrateDatabase(db)).toThrow(DataVersionError);
  });

  it("rolls back a failing step and stays at the last finished version", () => {
    const db = new DatabaseSync(":memory:");
    const steps: SchemaMigration[] = [
      { version: 1, description: "one", up: (d) => d.exec("CREATE TABLE a (x)") },
      { version: 2, description: "two", up: (d) => { d.exec("CREATE TABLE b (x)"); throw new Error("boom"); } },
    ];
    expect(() => migrateDatabase(db, { migrations: steps })).toThrow(/版本 2/);
    expect(Number(db.prepare("PRAGMA user_version").get()?.user_version)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='b'").get()).toBeUndefined();
  });
});

describe("migrateDirectory", () => {
  it("stamps an unversioned directory and runs later steps once", () => {
    const dir = temp();
    const seen: number[] = [];
    const steps = [1, 2].map((version) => ({ version, description: `v${version}`, up: () => { seen.push(version); } }));
    expect(migrateDirectory(dir, "layout.json", steps).applied).toEqual([1, 2]);
    expect(JSON.parse(readFileSync(join(dir, "layout.json"), "utf8")).formatVersion).toBe(2);
    expect(migrateDirectory(dir, "layout.json", steps).applied).toEqual([]);
    expect(seen).toEqual([1, 2]);
  });

  it("refuses a layout from a newer app", () => {
    const dir = temp();
    writeFileSync(join(dir, "layout.json"), JSON.stringify({ formatVersion: 99 }));
    expect(() => migrateDirectory(dir, "layout.json", [{ version: 1, description: "", up: () => {} }])).toThrow(DataVersionError);
  });
});

describe("StudioStore upgrade", () => {
  it("upgrades a version 3 data directory in place: backup, layout and library markers", () => {
    const dir = temp();
    const path = join(dir, "studio.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA user_version=3; CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL, idempotency TEXT UNIQUE, deleted INTEGER NOT NULL DEFAULT 0);");
    legacy.close();
    const db = new StudioStore(path);
    expect(db.migration).toMatchObject({ from: 3, to: SCHEMA_VERSION });
    expect(readdirSync(join(dir, "backups"))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "layout.json"), "utf8")).formatVersion).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "library", "modules", "library.json"), "utf8")).formatVersion).toBe(1);
    db.setMeta("appVersion", "0.2.0");
    expect(db.meta("appVersion")).toBe("0.2.0");
    db.close();
    const again = new StudioStore(path);
    expect(again.migration.applied).toEqual([]);
    again.close();
  });
});
