import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleNotebookApi } from "@/features/notebook/server/http";
import { handleProjectsApi } from "@/features/workspace/server/http";
import { EXAMPLE_PROJECT_ID, IF_EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { StudioStore } from "@/lib/server/database";
import { EXAMPLE_MODULE_IDS } from "../examples";
import { IF_EXAMPLE_MODULE_IDS } from "../examples-if";
import { IF_SIDE_FILES, IF_SIDE_MODULE_IDS } from "../examples-if-side";

describe("example project on a fresh install", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("is listed once, with its notebooks, modules, workflow and data", async () => {
    dir = mkdtempSync(join(tmpdir(), "nfs-example-"));
    const db = new StudioStore(join(dir, "studio.sqlite"));
    try {
      const list = await (await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db)).json() as { projects: { id: string; path: string }[] };
      const example = list.projects.find((project) => project.id === EXAMPLE_PROJECT_ID);
      expect(example).toBeDefined();
      expect(db.notebooks().filter((doc) => doc.projectId === EXAMPLE_PROJECT_ID).map((doc) => doc.id)).toEqual(["count_qc", "normalize_pca", "group_compare", "summary_report"]);
      expect(db.scriptModules().map((mod) => mod.id).sort()).toEqual([...EXAMPLE_MODULE_IDS, ...IF_EXAMPLE_MODULE_IDS, ...IF_SIDE_MODULE_IDS].sort());
      expect(EXAMPLE_MODULE_IDS.every((id) => db.libraryCopy(id))).toBe(true);
      expect(db.workflows().map((doc) => doc.projectId).sort()).toEqual([EXAMPLE_PROJECT_ID, IF_EXAMPLE_PROJECT_ID, IF_EXAMPLE_PROJECT_ID].sort());
      expect(readFileSync(join(example!.path, "data", "samples.csv"), "utf8")).toContain("ctrl_1,control,A");
      expect(existsSync(join(example!.path, "data", "counts.tsv"))).toBe(true);
      // Deleting the example workflow does not bring it back; the project stays.
      db.deleteWorkflow("example_expression");
      await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db);
      expect(db.workflow("example_expression")).toBeUndefined();
      expect(db.project(EXAMPLE_PROJECT_ID)).toBeDefined();
      // Its notebooks open and can be deleted, file and all.
      const opened = await handleNotebookApi("GET", ["notebooks", "count_qc"], new Request("http://studio.local/api/notebooks/count_qc"), db);
      expect(opened.status).toBe(200);
      const files = () => readdirSync(join(example!.path, "notebooks"));
      expect(files().length).toBe(4);
      const deleted = await handleNotebookApi("DELETE", ["notebooks", "count_qc"], new Request("http://studio.local/api/notebooks/count_qc", { method: "DELETE" }), db);
      expect(deleted.status).toBe(204);
      expect(db.notebook("count_qc")).toBeUndefined();
      expect(files().length).toBe(3);
      await handleNotebookApi("GET", ["notebooks"], new Request("http://studio.local/api/notebooks"), db);
      expect(db.notebook("count_qc")).toBeUndefined();
      // It is an ordinary project: removing it from the list does not bring it back either.
      const removed = await handleProjectsApi("DELETE", ["projects", EXAMPLE_PROJECT_ID], new Request(`http://studio.local/api/projects/${EXAMPLE_PROJECT_ID}`, { method: "DELETE" }), db);
      expect(removed.status).toBe(204);
      const after = await (await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db)).json() as { projects: { id: string }[] };
      expect(after.projects.map((project) => project.id)).not.toContain(EXAMPLE_PROJECT_ID);
    } finally {
      db.close();
    }
  });

  it("includes the immunofluorescence example, seeded once with its image", async () => {
    dir = mkdtempSync(join(tmpdir(), "nfs-example-if-"));
    const db = new StudioStore(join(dir, "studio.sqlite"));
    try {
      const list = await (await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db)).json() as { projects: { id: string; name: string; path: string }[] };
      const project = list.projects.find((item) => item.id === IF_EXAMPLE_PROJECT_ID);
      expect(project?.name).toBe("免疫荧光分析示例");
      expect(project!.path).toBe(join(dir, "projects", IF_EXAMPLE_PROJECT_ID));
      expect(db.notebooks().filter((doc) => doc.projectId === IF_EXAMPLE_PROJECT_ID).map((doc) => doc.id).sort()).toEqual([
        "if_preprocess", "if_segment", "if_postprocess", "if_measure", "if_summarize",
        "if_morph_extra", "if_neighbors", "if_object_clf", "if_coloc", "if_membrane_seg", "if_blob_detect", "if_pixel_clf_apoc", "if_timelapse_intensity",
      ].sort());
      expect([...IF_EXAMPLE_MODULE_IDS, ...IF_SIDE_MODULE_IDS].every((id) => db.libraryCopy(id))).toBe(true);
      expect(db.workflow("example_if")!.nodes.length).toBe(6);
      const side = db.workflow("example_if_side")!;
      expect(side.projectId).toBe(IF_EXAMPLE_PROJECT_ID);
      expect(side.edges.filter((item) => item.source === "post").map((item) => item.target).sort()).toEqual(["coloc", "coloc", "morph", "neighbors", "objclf"]);
      for (const file of IF_SIDE_FILES) {
        expect(readFileSync(join(project!.path, file.path)).length).toBe(readFileSync(join(process.cwd(), ...file.asset)).length);
      }
      expect(db.scriptModule("script/if_postprocess")?.outputs.map((port) => port.name)).toEqual(["nuclei", "cells"]);
      const workflow = db.workflow("example_if")!;
      expect(workflow.projectId).toBe(IF_EXAMPLE_PROJECT_ID);
      expect(workflow.edges.filter((item) => item.source === "image").map((item) => item.target).sort()).toEqual(["measure", "pre", "summary"]);
      const image = readFileSync(join(project!.path, "data", "image.tif"));
      expect(image.length).toBe(readFileSync(join(process.cwd(), "public", "examples", "if", "IXMtest_A02_s9.tif")).length);
      // Removed from the list, it stays gone.
      await handleProjectsApi("DELETE", ["projects", IF_EXAMPLE_PROJECT_ID], new Request(`http://studio.local/api/projects/${IF_EXAMPLE_PROJECT_ID}`, { method: "DELETE" }), db);
      const after = await (await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db)).json() as { projects: { id: string }[] };
      expect(after.projects.map((item) => item.id)).not.toContain(IF_EXAMPLE_PROJECT_ID);
    } finally {
      db.close();
    }
  });

  it("adds the IF side branches once to a project seeded before they existed, keeping user edits", async () => {
    dir = mkdtempSync(join(tmpdir(), "nfs-example-if-side-"));
    const db = new StudioStore(join(dir, "studio.sqlite"));
    try {
      await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db);
      // Roll back to an install from before the side branches.
      db.setMeta("ifSideExampleSeeded", "");
      for (const id of IF_SIDE_MODULE_IDS) db.deleteNotebook(id.replace("script/", ""));
      db.deleteWorkflow("example_if_side");
      db.deleteWorkflow("example_if");
      await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db);
      expect(db.workflow("example_if_side")).toBeDefined();
      // The main workflow the user deleted stays deleted.
      expect(db.workflow("example_if")).toBeUndefined();
      db.deleteWorkflow("example_if_side");
      await handleProjectsApi("GET", ["projects"], new Request("http://studio.local/api/projects"), db);
      expect(db.workflow("example_if_side")).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
