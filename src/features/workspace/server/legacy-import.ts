import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { workflowInput } from "@/features/runs/server/service";
import type { ModuleLibraryCopy } from "@/features/notebook/library-copy";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";
import type { StudioStore } from "@/lib/server/database";

/**
 * Before project folders held everything, workflows and published modules lived in one database in the data
 * directory (`studio.sqlite`); notebooks were already `.ipynb` files in project folders. The current app neither
 * reads nor deletes that file. This module offers its workflows and modules once, to be copied into a project.
 */
export const LEGACY_DATABASE = "studio.sqlite";
/** Imported workflows land here, so they are easy to find and to move. */
export const LEGACY_FOLDER = "workflows/旧版导入";

export interface LegacySummary { workflows: number; modules: number }
export interface LegacyImport { workflows: number; modules: number; skipped: string[] }

function rows(dataDir: string): { workflows: unknown[]; modules: unknown[]; library: unknown[] } | undefined {
  const path = join(dataDir, LEGACY_DATABASE);
  if (!existsSync(path)) return undefined;
  let db: DatabaseSync;
  try { db = new DatabaseSync(path, { readOnly: true }); } catch { return undefined; }
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)));
    const read = (table: string) => tables.has(table) ? db.prepare(`SELECT data FROM ${table}`).all().flatMap((row) => {
      try { return [JSON.parse(String(row.data)) as unknown]; } catch { return []; }
    }) : [];
    return { workflows: read("workflows"), modules: read("script_modules"), library: read("module_library") };
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/** What the old database still holds, or `undefined` when there is none (or nothing in it). */
export function legacySummary(dataDir: string): LegacySummary | undefined {
  const found = rows(dataDir);
  if (!found || (!found.workflows.length && !found.modules.length)) return undefined;
  return { workflows: found.workflows.length, modules: found.modules.length };
}

const moduleLike = (value: unknown): value is ModuleDef => {
  const mod = value as Partial<ModuleDef> | null;
  return !!mod && typeof mod.id === "string" && typeof mod.name === "string" && typeof mod.path === "string";
};

/**
 * Copies the old database's modules, with their editable notebook copies, into the project's `modules/` (keeping
 * their ids, so imported workflow nodes still find them) and its workflows into `workflows/旧版导入/`. Anything the project already has, or that no longer
 * parses, is skipped and named. The old database is left as it was, so importing into another project works too.
 */
export function importLegacy(dataDir: string, project: StudioStore): LegacyImport {
  const found = rows(dataDir);
  const result: LegacyImport = { workflows: 0, modules: 0, skipped: [] };
  if (!found || !project.documents) return result;
  const knownModules = new Set(project.scriptModules().map((mod) => mod.id));
  // The editable notebook copy of each published module, so 编辑 still opens it after the import.
  const copies = new Map(found.library.flatMap((copy) => {
    const id = (copy as { moduleId?: unknown } | null)?.moduleId;
    return typeof id === "string" ? [[id, copy as ModuleLibraryCopy] as const] : [];
  }));
  for (const value of found.modules) {
    if (!moduleLike(value)) { result.skipped.push("一个无法识别的模块"); continue; }
    if (knownModules.has(value.id)) { result.skipped.push(`模块 ${value.name}（项目里已有）`); continue; }
    try {
      project.saveScriptModule(value);
      const copy = copies.get(value.id);
      if (copy) project.saveLibraryCopy(copy);
      knownModules.add(value.id);
      result.modules++;
    }
    catch (error) { result.skipped.push(`模块 ${value.name}：${error instanceof Error ? error.message : "写入失败"}`); }
  }
  const knownWorkflows = new Set(project.workflows().map((doc) => doc.id));
  for (const value of found.workflows) {
    const name = (value as { name?: unknown } | null)?.name;
    const label = typeof name === "string" && name ? name : "未命名流程";
    let doc: WorkflowDoc;
    try { doc = workflowInput(value); }
    catch { result.skipped.push(`流程 ${label}（格式已不兼容）`); continue; }
    if (knownWorkflows.has(doc.id)) { result.skipped.push(`流程 ${label}（项目里已有）`); continue; }
    project.saveWorkflow({
      ...doc, projectId: project.projectHandle, fileVersion: undefined,
      filePath: project.documents.files.available(LEGACY_FOLDER, doc.name || label, ".workflow.json"),
      updatedAt: (value as { updatedAt?: string }).updatedAt ?? new Date().toISOString(),
    });
    knownWorkflows.add(doc.id);
    result.workflows++;
  }
  return result;
}
