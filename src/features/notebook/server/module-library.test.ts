import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { demoScriptModules } from "@/features/notebook/seed";
import { exportModuleLibrary, libraryEntryDirectory, ModuleLibraryError, readEnvironmentYml, writeLibraryModule } from "@/features/notebook/server/module-library";
import { StudioStore } from "@/lib/server/database";

const directories: string[] = [];
const temp = () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-modlib-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const hello = () => structuredClone(demoScriptModules().find((def) => def.id === "script/hello_py/v2")!);

describe("module library", () => {
  it("files a version under namespace, name and version", async () => {
    const root = temp();
    const def = hello();
    const { directory, written } = await writeLibraryModule(def, root);
    expect(written).toBe(true);
    expect(directory).toBe(join(root, "local", "hello_py", "v2"));
    expect((await readdir(directory)).sort()).toEqual(["main.nf", "meta.yml", "module.json", "resources"]);
    const cli = join(directory, "resources/usr/bin/hello_py_v2.py");
    expect(await readFile(cli, "utf8")).toBe(def.script);
    expect(statSync(cli).mode & 0o111).not.toBe(0);
    const record = JSON.parse(await readFile(join(directory, "module.json"), "utf8"));
    expect(record.id).toBe(def.id);
    expect(record.script).toBeUndefined();
    // Nothing left over from the staged write.
    expect(await readdir(join(root, "local", "hello_py"))).toEqual(["v2"]);
  });

  it("leaves an unchanged version alone and refreshes one whose environment changed", async () => {
    const root = temp();
    const def = hello();
    await writeLibraryModule(def, root);
    expect((await writeLibraryModule(def, root)).written).toBe(false);
    const edited = { ...def, condaYaml: "/envs/hello.yml", environmentYml: "dependencies: [python=3.11]" };
    expect((await writeLibraryModule(edited, root)).written).toBe(true);
    const directory = libraryEntryDirectory(def, root);
    expect(await readFile(join(directory, "environment.yml"), "utf8")).toBe("dependencies: [python=3.11]\n");
    expect(await readFile(join(directory, "main.nf"), "utf8")).toContain('conda "${moduleDir}/environment.yml"');
    expect(await readdir(join(root, "local", "hello_py"))).toEqual(["v2"]);
  });

  it("refuses a different module claiming the same version folder", async () => {
    const root = temp();
    await writeLibraryModule(hello(), root);
    await expect(writeLibraryModule({ ...hello(), id: "script/other/v2" }, root)).rejects.toThrow(ModuleLibraryError);
  });

  it("rejects path segments that could leave the library", () => {
    expect(() => libraryEntryDirectory({ ...hello(), namespace: ".." }, "/lib")).toThrow(ModuleLibraryError);
    expect(() => libraryEntryDirectory({ ...hello(), version: "v2/../../x" }, "/lib")).toThrow(ModuleLibraryError);
  });

  it("copies the conda file a module names, when it is small and readable", async () => {
    const directory = temp();
    const path = join(directory, "env.yml");
    writeFileSync(path, "dependencies:\n  - python=3.11\n");
    expect(await readEnvironmentYml(path)).toBe("dependencies:\n  - python=3.11");
    expect(await readEnvironmentYml(join(directory, "missing.yml"))).toBeUndefined();
    expect(await readEnvironmentYml("bioconda::samtools=1.21")).toBeUndefined();
    expect(await readEnvironmentYml(undefined)).toBeUndefined();
  });

  it("exports modules published before the library existed", async () => {
    const directory = temp();
    const db = new StudioStore(join(directory, "studio.sqlite"));
    try {
      for (const def of demoScriptModules()) db.saveScriptModule(def);
      expect(db.moduleLibrary).toBe(join(directory, "library", "modules"));
      const count = await exportModuleLibrary(db, db.moduleLibrary!);
      expect(count).toBe(demoScriptModules().filter((def) => def.script && def.version).length);
      expect(await exportModuleLibrary(db, db.moduleLibrary!)).toBe(0);
    } finally {
      db.db.close();
    }
  });
});
