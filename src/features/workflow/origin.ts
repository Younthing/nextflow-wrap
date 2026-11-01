import { CATALOG_BUILTIN_IDS } from "./catalog-builtins";
import { REFERENCE_ID, SAMPLESHEET_ID } from "./builtins";
import type { ModuleDef, ModuleOrigin } from "./types";

export function moduleOrigin(def: ModuleDef): ModuleOrigin {
  if (def.origin) return def.origin;
  if (def.builtin || def.id.startsWith("builtin/")) return "builtin";
  if (def.id.startsWith("script/")) return "script";
  return "nf-core";
}

export function versionNumber(version: string | undefined): number {
  const match = /^v(\d+)$/.exec(version ?? "");
  return match ? Number(match[1]) : 0;
}

/** Builtins listed on `/workflows/modules` ahead of the optional nf-core section. */
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
 * nf-core stays out until the user shows it.
 */
export function modulesForDrawer(modules: readonly ModuleDef[], showNfCore: boolean): ModuleDef[] {
  const latestIds = new Set(latestPassedScripts(modules).map((def) => def.id));
  return modules.filter((def) => {
    if (def.temporary) return false;
    const origin = moduleOrigin(def);
    if (origin === "script") return latestIds.has(def.id);
    if (origin === "nf-core") return showNfCore;
    return true;
  });
}

/**
 * Module catalog rows.
 * Failed script modules stay visible (labeled 不可拖入). nf-core is opt-in.
 */
export function modulesForCatalog(modules: readonly ModuleDef[], showNfCore: boolean): ModuleDef[] {
  return modules.filter((def) => {
    if (def.temporary) return false;
    const origin = moduleOrigin(def);
    if (origin === "nf-core") return showNfCore;
    if (origin === "script") return true;
    return isCatalogBuiltin(def);
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

export function moduleListLabel(def: ModuleDef): string {
  return moduleOrigin(def) === "nf-core" ? def.path : def.name;
}
