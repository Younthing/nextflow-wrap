import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoNotebooks, demoScriptModules } from "@/features/notebook/seed";
import { qcDemoWorkflow } from "@/features/workflow/qc-demo";
import { StudioStore } from "./database";

describe("StudioStore", () => {
  it("persists workflow edits across connections and rolls back failed transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-db-"));
    try {
      const first = new StudioStore(join(directory, "studio.sqlite"));
      first.saveWorkflow(qcDemoWorkflow());
      expect(() => first.transaction(() => { first.deleteWorkflow("qc-smoke"); throw new Error("rollback"); })).toThrow("rollback");
      first.close();
      const reopened = new StudioStore(join(directory, "studio.sqlite"));
      expect(reopened.workflow("qc-smoke")?.name).toBe("FastQC and MultiQC");
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps a newer workflow when a write still carries the old revision", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-db-"));
    try {
      const db = new StudioStore(join(directory, "studio.sqlite"));
      const original = qcDemoWorkflow();
      db.saveWorkflow(original);
      const renamed = db.putWorkflow({ ...original, name: "壳复验改名" });
      expect(renamed.status).toBe("ok");
      if (renamed.status !== "ok") return;
      const late = db.putWorkflow({ ...original, name: "late-dirty" });
      expect(late).toEqual({ status: "stale" });
      expect(db.workflow(original.id)?.name).toBe("壳复验改名");
      const again = db.putWorkflow({ ...renamed.doc, name: "再次改名" });
      expect(again.status).toBe("ok");
      expect(db.workflow(original.id)?.name).toBe("再次改名");
      db.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("bumps a notebook revision only when cells change", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-db-"));
    try {
      const db = new StudioStore(join(directory, "studio.sqlite"));
      const notebook = demoNotebooks().find((doc) => doc.id === "sample_clean")!;
      const saved = db.saveNotebook({ ...notebook, rev: 1 });
      expect(saved.rev).toBe(1);
      const renamed = db.saveNotebook({ ...saved, name: "样本表清洗 2" });
      expect(renamed.rev).toBe(1);
      const edited = db.saveNotebook({ ...renamed, cells: [...renamed.cells, { id: "extra", role: "code", source: "print(1)\n" }] });
      expect(edited.rev).toBe(2);
      expect(db.revision(notebook.id, 2)?.cells).toHaveLength(edited.cells.length);
      db.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("round-trips conda and container on a script module", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-db-"));
    try {
      const db = new StudioStore(join(directory, "studio.sqlite"));
      const mod = {
        ...demoScriptModules().find((item) => item.id === "script/hello_py/v2")!,
        condaYaml: "/envs/py311-pandas.yml",
        containerImage: "ghcr.io/org/py311-pandas:1.2",
      };
      db.saveScriptModule(mod);
      db.close();
      const reopened = new StudioStore(join(directory, "studio.sqlite"));
      const loaded = reopened.scriptModule(mod.id);
      expect(loaded?.condaYaml).toBe("/envs/py311-pandas.yml");
      expect(loaded?.containerImage).toBe("ghcr.io/org/py311-pandas:1.2");
      expect(loaded?.kernel).toBe(mod.kernel);
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
