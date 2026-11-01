import { CATALOG_BUILTIN_IDS } from "./catalog-builtins";
import { REFERENCE_ID, SAMPLESHEET_ID } from "./builtins";
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

/** Builtins listed on `/workflows/modules` next to the published modules. */
export function isCatalogBuiltin(def: ModuleDef): boolean {
  return def.id === SAMPLESHEET_ID || def.id === REFERENCE_ID || CATALOG_BUILTIN_IDS.has(def.id);
}

/** Latest try-run-passed script module for each source notebook. */
export function latestPassedScripts(modules: readonly ModuleDef[]): ModuleDef[] {
  const best = new Map<string, ModuleDef>();
  for (const def of modules) {
    if (moduleOrigin(def) !== "script" || def.tryRun !== "passed") continue;
    const key = def.sourceNotebookId ?? def.id;
    const prev = best.get(key);
    if (!prev || versionNumber(def.version) >= versionNumber(prev.version)) best.set(key, def);
  }
  return [...best.values()];
}

/**
 * Canvas drawer and node search.
 * Try-run-failed script modules are omitted entirely.
 */
export function modulesForDrawer(modules: readonly ModuleDef[]): ModuleDef[] {
  const latestIds = new Set(latestPassedScripts(modules).map((def) => def.id));
  return modules.filter((def) => {
    if (def.temporary) return false;
    const origin = moduleOrigin(def);
    return origin === "script" ? latestIds.has(def.id) : true;
  });
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

/** A newer passed publish of the same notebook, if the node is still on an older version. */
export function newerScriptModule(current: ModuleDef, modules: readonly ModuleDef[]): ModuleDef | undefined {
  if (moduleOrigin(current) !== "script" || !current.sourceNotebookId) return undefined;
  const currentVersion = versionNumber(current.version);
  let best: ModuleDef | undefined;
  for (const def of modules) {
    if (def.sourceNotebookId !== current.sourceNotebookId || def.tryRun !== "passed") continue;
    if (versionNumber(def.version) <= currentVersion) continue;
    if (!best || versionNumber(def.version) > versionNumber(best.version)) best = def;
  }
  return best;
}
