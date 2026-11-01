import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexModules } from "@/features/workflow/catalog";
import { hostChainWorkflow } from "@/features/workflow/host-chain-demo";
import { generateProject } from "../generate";
import { materializeProject, projectPath, syncProject } from "./materialize";

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

describe("syncProject", () => {
  const snapshot = (files: Record<string, string>) => ({ files: Object.entries(files).map(([path, content]) => ({ path, content })) });

  it("keeps unchanged files untouched so Nextflow task hashes stay stable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nf-studio-sync-"));
    temporaryDirectories.push(directory);
    expect((await syncProject(snapshot({ "main.nf": "a", "bin/main.py": "print(1)" }), directory)).written).toEqual(["main.nf", "bin/main.py"]);
    const before = (await stat(join(directory, "bin/main.py"))).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await syncProject(snapshot({ "main.nf": "b", "bin/main.py": "print(1)" }), directory);
    expect(result.written).toEqual(["main.nf"]);
    expect((await stat(join(directory, "bin/main.py"))).mtimeMs).toBe(before);
    expect(await readFile(join(directory, "main.nf"), "utf8")).toBe("b");
  });

  it("removes files an earlier snapshot wrote and keeps everything else", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nf-studio-sync-"));
    temporaryDirectories.push(directory);
    await syncProject(snapshot({ "main.nf": "a", "bin/old.py": "x" }), directory);
    await writeFile(join(directory, "notes.txt"), "mine");
    const result = await syncProject(snapshot({ "main.nf": "a" }), directory);
    expect(result).toEqual({ written: [], removed: ["bin/old.py"] });
    await expect(stat(join(directory, "bin/old.py"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(directory, "notes.txt"), "utf8")).toBe("mine");
  });

  it("rejects snapshot paths outside the project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nf-studio-sync-"));
    temporaryDirectories.push(directory);
    await expect(syncProject(snapshot({ "../escape": "x" }), directory)).rejects.toThrow("Invalid project path");
  });
});
