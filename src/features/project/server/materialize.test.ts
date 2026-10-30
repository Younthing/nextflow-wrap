import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import catalog from "@/data/nf-core-modules.json";
import { indexModules } from "@/features/workflow/catalog";
import { qcDemoWorkflow } from "@/features/workflow/qc-demo";
import type { ModuleCatalog } from "@/features/workflow/types";
import { generateProject } from "../generate";
import { materializeProject, projectPath } from "./materialize";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("materializeProject", () => {
  it("writes an execution project without claiming remote components are installed", async () => {
    const parent = await mkdtemp(join(tmpdir(), "nf-studio-"));
    temporaryDirectories.push(parent);
    const directory = join(parent, "project");
    const typed = catalog as ModuleCatalog;
    const project = generateProject(qcDemoWorkflow(), indexModules(typed.modules), { modulesSha: typed.gitSha });
    await materializeProject(project, directory);
    expect(await readFile(join(directory, "main.nf"), "utf8")).toContain("workflow {");
    expect(JSON.parse(await readFile(join(directory, "components.lock.json"), "utf8")).repos).toBeDefined();
    await expect(readFile(join(directory, "modules.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(materializeProject(project, directory)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("rejects paths outside the execution project", () => {
    for (const path of ["../params.json", "a/../../outside", "/tmp/escape", "."]) {
      expect(() => projectPath("/tmp/project", path)).toThrow("Invalid project path");
    }
    expect(projectPath("/tmp/project", "conf/modules.config")).toBe("/tmp/project/conf/modules.config");
  });
});
