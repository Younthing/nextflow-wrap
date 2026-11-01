import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexModules } from "@/features/workflow/catalog";
import { hostChainWorkflow } from "@/features/workflow/host-chain-demo";
import { generateProject } from "../generate";
import { materializeProject, projectPath } from "./materialize";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("materializeProject", () => {
  it("writes every project file once", async () => {
    const parent = await mkdtemp(join(tmpdir(), "nf-studio-"));
    temporaryDirectories.push(parent);
    const directory = join(parent, "project");
    const project = generateProject(hostChainWorkflow("/tmp/inputs"), indexModules([]));
    await materializeProject(project, directory);
    expect(await readFile(join(directory, "main.nf"), "utf8")).toContain("workflow {");
    expect(await readFile(join(directory, "nextflow.config"), "utf8")).toContain("profiles {");
    await expect(materializeProject(project, directory)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("rejects paths outside the execution project", () => {
    for (const path of ["../params.json", "a/../../outside", "/tmp/escape", "."]) {
      expect(() => projectPath("/tmp/project", path)).toThrow("Invalid project path");
    }
    expect(projectPath("/tmp/project", "conf/modules.config")).toBe("/tmp/project/conf/modules.config");
  });
});
