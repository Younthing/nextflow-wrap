import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { StudioStore } from "./database";
import { DataVersionError, SCHEMA_VERSION } from "./schema";

describe("database schema", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const fresh = () => join((dir = mkdtempSync(join(tmpdir(), "nfs-schema-"))), "studio.sqlite");

  it("creates the schema in a new file and opens it again as is", () => {
    const path = fresh();
    const db = new StudioStore(path);
    expect(Number(db.db.prepare("PRAGMA user_version").get()?.user_version)).toBe(SCHEMA_VERSION);
    db.setMeta("k", "v");
    db.close();
    const again = new StudioStore(path);
    expect(again.meta("k")).toBe("v");
    again.close();
  });

  it("refuses a file from an older app or another version, without touching it", () => {
    const path = fresh();
    const old = new DatabaseSync(path);
    old.exec("PRAGMA user_version=5; CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
    old.close();
    expect(() => new StudioStore(path)).toThrow(DataVersionError);
    expect(() => new StudioStore(path)).toThrow(/删除数据目录/);

    const unversioned = join(dir, "unversioned.sqlite");
    const legacy = new DatabaseSync(unversioned);
    legacy.exec("CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
    legacy.close();
    expect(() => new StudioStore(unversioned)).toThrow(/旧版本/);
  });
});
