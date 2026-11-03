import { CATALOG_BUILTIN_IDS } from "./catalog-builtins";
import { FILE_ID, FOLDER_ID, SAMPLESHEET_ID } from "./builtins";
import type { ModuleDef, ModuleOrigin } from "./types";

export function moduleOrigin(def: ModuleDef): ModuleOrigin {
  if (def.origin) return def.origin;
  if (def.id.startsWith("script/")) return "script";
  return "builtin";
}

export function versionNumber(version: string | undefined): number {
  const match = /^v(\d+)$/.exec(version ?? "");
  return match ? Number(match[1]) : 0;
}

/** Builtins listed on `/modules` next to the published modules. */
export function isCatalogBuiltin(def: ModuleDef): boolean {
  return def.id === FILE_ID || def.id === FOLDER_ID || def.id === SAMPLESHEET_ID || CATALOG_BUILTIN_IDS.has(def.id);
}

/**
 * Canvas drawer and node search.
 * Try-run-failed script modules are omitted entirely.
 */
export function modulesForDrawer(modules: readonly ModuleDef[]): ModuleDef[] {
  return modules.filter((def) => !def.temporary && (moduleOrigin(def) !== "script" || def.tryRun === "passed"));
}

/**
 * Module catalog rows.
 * Failed script modules stay visible (labeled 不可拖入).
 */
export function modulesForCatalog(modules: readonly ModuleDef[]): ModuleDef[] {
  return modules.filter((def) => {
    if (def.temporary) return false;
    return moduleOrigin(def) === "script" || isCatalogBuiltin(def);
  });
}
