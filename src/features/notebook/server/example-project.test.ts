import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleProjectsApi } from "@/features/workspace/server/http";
import { EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { StudioStore } from "@/lib/server/database";
import { EXAMPLE_MODULE_IDS } from "../examples";

describe("example project on a fresh install", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("lists the example project with its notebooks, modules, workflow and data", async () => {
    dir = mkdtempSync(join(tmpdir(), "nfs-example-"));
    const db = new StudioStore(join(dir, "studio.sqlite"));
    try {
      const list = await (await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db)).json() as { projects: { id: string; path: string }[] };
      const example = list.projects.find((project) => project.id === EXAMPLE_PROJECT_ID);
      expect(example).toBeDefined();
      expect(db.notebooks().filter((doc) => doc.projectId === EXAMPLE_PROJECT_ID).map((doc) => doc.id)).toEqual(["count_qc", "normalize_pca", "group_compare", "summary_report"]);
      expect(db.scriptModules().map((mod) => mod.id).sort()).toEqual([...EXAMPLE_MODULE_IDS].sort());
      expect(EXAMPLE_MODULE_IDS.every((id) => db.libraryCopy(id))).toBe(true);
      expect(db.workflows().map((doc) => doc.projectId)).toEqual([EXAMPLE_PROJECT_ID]);
      expect(readFileSync(join(example!.path, "data", "samples.csv"), "utf8")).toContain("ctrl_1,control,A");
      expect(existsSync(join(example!.path, "data", "counts.tsv"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
