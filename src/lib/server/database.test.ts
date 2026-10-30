import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
