import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { StudioStore } from "@/lib/server/database";
import { importLegacy, LEGACY_DATABASE, LEGACY_FOLDER, legacySummary } from "./legacy-import";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const step of cleanup.splice(0)) step(); });

const workflow = { version: 1, id: "wf_old", name: "旧流程", updatedAt: "2026-01-01T00:00:00.000Z", params: {}, nodes: [], edges: [] };
const module = { id: "script/lab/qc", name: "qc", path: "qc_v1", version: "v1", origin: "script", script: "print('qc')\n", command: "qc.py", inputs: [], outputs: [] };

/** A data directory with the database of an app version from before project folders. */
function legacyDataDir(rows: { workflows?: unknown[]; modules?: unknown[] }) {
  const dir = mkdtempSync(join(tmpdir(), "studio-legacy-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dir, LEGACY_DATABASE));
  db.exec("CREATE TABLE workflows (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE script_modules (id TEXT PRIMARY KEY, data TEXT NOT NULL);");
  for (const doc of rows.workflows ?? []) db.prepare("INSERT INTO workflows VALUES (?,?)").run(String((doc as { id?: string }).id ?? Math.random()), JSON.stringify(doc));
  for (const mod of rows.modules ?? []) db.prepare("INSERT INTO script_modules VALUES (?,?)").run(String((mod as { id: string }).id), JSON.stringify(mod));
  db.close();
  return dir;
}

function project() {
  const root = mkdtempSync(join(tmpdir(), "studio-legacy-project-"));
  const db = new StudioStore(join(root, ".studio", "state.sqlite"), root, "p1");
  cleanup.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, db };
}

describe("legacy import", () => {
  it("finds nothing without an old database", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-legacy-none-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(legacySummary(dir)).toBeUndefined();
    expect(legacySummary(legacyDataDir({}))).toBeUndefined();
  });

  it("copies old workflows and modules into the project once and leaves the old database as it was", () => {
    const dir = legacyDataDir({ workflows: [workflow, { id: "broken", name: "坏流程" }], modules: [module] });
    expect(legacySummary(dir)).toEqual({ workflows: 2, modules: 1 });
    const { root, db } = project();
    const result = importLegacy(dir, db);
    expect(result).toEqual({ workflows: 1, modules: 1, skipped: ["流程 坏流程（格式已不兼容）"] });
    const imported = db.workflow("wf_old")!;
    expect(imported.filePath).toBe(`${LEGACY_FOLDER}/旧流程.workflow.json`);
    expect(imported.projectId).toBe("p1");
    // The module keeps its id, so imported nodes still resolve.
    expect(db.scriptModule("script/lab/qc")?.name).toBe("qc");
    expect(readFileSync(join(root, "modules/qc_v1/v1/script.py"), "utf8")).toBe("print('qc')\n");
    // A second import skips what is already there.
    expect(importLegacy(dir, db)).toMatchObject({ workflows: 0, modules: 0 });
    expect(existsSync(join(dir, LEGACY_DATABASE))).toBe(true);
    expect(legacySummary(dir)).toEqual({ workflows: 2, modules: 1 });
  });
});
