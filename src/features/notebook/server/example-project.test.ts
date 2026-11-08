import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioStore } from "@/lib/server/database";
import { ensureExampleProject } from "./http";
import { EXAMPLE_PROJECT_ID, IF_EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "studio-examples-"));
  const registry = new StudioStore(join(root, "registry.sqlite"));
  cleanup.push(() => { registry.close(); rmSync(root, { recursive: true, force: true }); });
  ensureExampleProject(registry);
  return registry;
}
function open(registry: StudioStore, id: string) {
  const project = registry.project(id)!;
  const db = new StudioStore(":memory:", project.path, id);
  cleanup.unshift(() => db.close());
  return db;
}
describe("file-based example projects", () => {
  it("seeds ordinary project files without putting their content in the registry", () => {
    const registry = setup();
    expect(registry.notebooks()).toEqual([]);
    const db = open(registry, EXAMPLE_PROJECT_ID);
    expect(db.notebooks()).toHaveLength(4);
    expect(db.workflows()).toHaveLength(1);
    expect(db.scriptModules()).toHaveLength(4);
    expect(existsSync(join(db.projectRoot!, "data/counts.tsv"))).toBe(true);
    for (const mod of db.scriptModules()) expect(existsSync(join(db.projectRoot!, mod.id))).toBe(true);
  });
  it("includes the immunofluorescence project and all its local module versions", () => {
    const registry = setup();
    const db = open(registry, IF_EXAMPLE_PROJECT_ID);
    expect(db.notebooks().length).toBeGreaterThan(5);
    expect(db.workflows()).toHaveLength(2);
    expect(existsSync(join(db.projectRoot!, "data/image.tif"))).toBe(true);
    expect(db.workflows().every((flow) => flow.nodes.every((node) => !node.data.moduleId.startsWith("modules/") || !!db.scriptModule(node.data.moduleId)))).toBe(true);
  });
  it("keeps user edits and deletions when the example setup runs again", () => {
    const registry = setup();
    const db = open(registry, EXAMPLE_PROJECT_ID);
    const notebook = db.notebooks()[0];
    db.saveNotebook({ ...notebook, description: "my analysis" });
    const deleted = db.notebooks()[1];
    db.deleteNotebook(deleted.id);
    ensureExampleProject(registry);
    expect(db.notebook(notebook.id)?.description).toBe("my analysis");
    expect(db.notebook(deleted.id)).toBeUndefined();
  });
});
