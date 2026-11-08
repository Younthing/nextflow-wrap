import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultLaunchConfig } from "@/features/project/launch";
import { emptyWorkflow } from "@/features/workflow/document";
import { StudioStore, type StoredExecution } from "@/lib/server/database";

function run(root: string): StoredExecution {
  return {
    lineageId: "run_one", projectRoot: root,
    projectDir: join(root, ".studio/runtime/workflows/flow"), attemptDir: join(root, "runs/run_one"),
    detail: {
      id: "run_one", runName: "analysis", workflowId: "flow", workflowName: "Analysis", status: "succeeded", executor: "local", profile: "",
      submittedAt: "2026-11-01T00:00:00Z", command: "nextflow run .", launch: defaultLaunchConfig(), runConfig: "",
      params: { outdir: join(root, "runs/run_one/results") }, project: { name: "analysis", files: [] }, workflow: emptyWorkflow("flow"),
      progress: { total: 1, completed: 1, pending: 0, running: 0, cached: 0, failed: 0, aborted: 0 },
    },
  };
}

describe("project execution records", () => {
  it("rebuilds runs and tasks after removing the cache database and preserves deletion", () => {
    const root = mkdtempSync(join(tmpdir(), "studio-state-"));
    const path = join(root, ".studio/state.sqlite");
    const open = () => new StudioStore(path, root, "project");
    try {
      let db = open();
      db.insertRun(run(root));
      db.putTask("run_one", { id: "1", hash: "aa/bb", nodeId: "node", process: "STEP", name: "STEP", status: "completed", cpus: 1, workdir: join(root, ".studio/runtime/work/aa/bb") });
      db.close();
      rmSync(path);
      db = open();
      expect(db.run("run_one")?.detail.status).toBe("succeeded");
      expect(db.tasks("run_one")).toHaveLength(1);
      db.deleteRun("run_one");
      db.close();
      rmSync(path);
      db = open();
      expect(db.run("run_one")).toBeUndefined();
      expect(db.run("run_one", true)?.deleted).toBe(true);
      db.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rebases historical results even when a copied project includes its cache database", () => {
    const parent = mkdtempSync(join(tmpdir(), "studio-copy-"));
    const original = join(parent, "original");
    const copy = join(parent, "copy");
    try {
      const db = new StudioStore(join(original, ".studio/state.sqlite"));
      db.close();
      const first = new StudioStore(join(original, ".studio/state.sqlite"), original, "first");
      first.insertRun(run(original));
      first.close();
      cpSync(original, copy, { recursive: true });
      const second = new StudioStore(join(copy, ".studio/state.sqlite"), copy, "second");
      expect(second.run("run_one")?.detail.params.outdir).toBe(join(copy, "runs/run_one/results"));
      expect(second.run("run_one")?.detail.workCleanedAt).toBeTruthy();
      second.close();
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});
