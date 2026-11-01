import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ModuleLibraryCopy } from "@/features/notebook/library-copy";
import { moduleNamespace, moduleSlugOf, scriptModuleFiles } from "@/features/project/script-process";
import type { ModuleDef } from "@/features/workflow/types";
import type { StudioStore } from "@/lib/server/database";

/** Largest conda environment file copied into a module. Real ones are a few hundred bytes. */
const ENVIRONMENT_MAX = 256 * 1024;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}$/;

export class ModuleLibraryError extends Error {}

/** `<library>/<namespace>/<name>/<version>/` for a published script module. */
export function libraryEntryDirectory(def: ModuleDef, root: string): string {
  const segments = [moduleNamespace(def), moduleSlugOf(def), def.version ?? ""];
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) throw new ModuleLibraryError(`模块库路径段无效：${segment || "(空)"}`);
  }
  return join(root, ...segments);
}

/** Contents of the conda file a module names, so the module can carry its own `environment.yml`. */
export async function readEnvironmentYml(path: string | undefined): Promise<string | undefined> {
  if (!path?.trim()) return undefined;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > ENVIRONMENT_MAX) return undefined;
    return (await readFile(path, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

function entryFiles(def: ModuleDef, copy?: ModuleLibraryCopy) {
  const files: { path: string; content: string; executable?: boolean }[] = scriptModuleFiles(def);
  if (copy) {
    const ext = copy.command.endsWith(".R") ? "R" : "py";
    files.push({ path: `notebook.${ext}`, content: copy.percent });
  }
  // Everything the app needs to list the module again, without the script body already on disk.
  const record: Partial<ModuleDef> = { ...def };
  delete record.script;
  files.push({ path: "module.json", content: `${JSON.stringify(record, null, 2)}\n` });
  return files;
}

async function readRecord(directory: string): Promise<string | undefined> {
  return readFile(join(directory, "module.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

async function sameFiles(directory: string, files: { path: string; content: string }[]): Promise<boolean> {
  for (const file of files) {
    const current = await readFile(join(directory, file.path), "utf8").catch(() => undefined);
    if (current !== file.content) return false;
  }
  return true;
}

/**
 * Write one published version into the library, as `<namespace>/<name>/<version>/`.
 * A version belongs to one module id: another module claiming the folder is refused. The CLI and ports of a
 * version never change, but its conda / container fields can be edited, so the same module refreshes its folder.
 * The folder is swapped in whole, never half written.
 */
export async function writeLibraryModule(def: ModuleDef, root: string, copy?: ModuleLibraryCopy): Promise<{ directory: string; written: boolean }> {
  if (!def.script || !def.version) throw new ModuleLibraryError("只有已发布的脚本模块可以进入模块库");
  const directory = libraryEntryDirectory(def, root);
  const files = entryFiles(def, copy);
  const existing = await readRecord(directory);
  if (existing !== undefined) {
    const id = (JSON.parse(existing) as { id?: string }).id;
    if (id !== def.id) throw new ModuleLibraryError(`模块库里 ${directory} 已属于 ${id ?? "另一个模块"}`);
    if (await sameFiles(directory, files)) return { directory, written: false };
  }
  await mkdir(dirname(directory), { recursive: true });
  const staging = join(dirname(directory), `.staging-${randomUUID()}`);
  const retired = join(dirname(directory), `.retired-${randomUUID()}`);
  try {
    for (const file of files) {
      const path = join(staging, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, { flag: "wx" });
      if (file.executable) await chmod(path, 0o755);
    }
    if (existing !== undefined) await rename(directory, retired);
    try {
      await rename(staging, directory);
    } catch (error) {
      if (existing !== undefined) await rename(retired, directory);
      throw error;
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    const code = (error as NodeJS.ErrnoException).code;
    // Another writer finished the same version first; check what it wrote.
    if (existing === undefined && (code === "ENOTEMPTY" || code === "EEXIST")) return writeLibraryModule(def, root, copy);
    throw error;
  }
  if (existing !== undefined) await rm(retired, { recursive: true, force: true });
  return { directory, written: true };
}

/** Make sure every published script module in the database also has its library folder. */
export async function exportModuleLibrary(db: StudioStore, root: string): Promise<number> {
  let written = 0;
  for (const def of db.scriptModules()) {
    if (!def.script || !def.version) continue;
    try {
      if ((await writeLibraryModule(def, root, db.libraryCopy(def.id))).written) written += 1;
    } catch (error) {
      console.error(`模块库导出失败：${def.id}`, error);
    }
  }
  return written;
}

const exported = new WeakMap<StudioStore, Promise<number>>();

/** Exports a database's modules once per server process. Modules published before the library existed get folders. */
export function ensureModuleLibrary(db: StudioStore): Promise<number> {
  if (!db.moduleLibrary) return Promise.resolve(0);
  let pending = exported.get(db);
  if (!pending) {
    pending = exportModuleLibrary(db, db.moduleLibrary);
    exported.set(db, pending);
  }
  return pending;
}
