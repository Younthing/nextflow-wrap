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

/** Every published version of the notebook a script module came from, newest first. */
export function scriptModuleVersions(current: ModuleDef, modules: readonly ModuleDef[]): ModuleDef[] {
  if (moduleOrigin(current) !== "script" || !current.sourceNotebookId) return [current];
  const family = modules.filter((def) => def.sourceNotebookId === current.sourceNotebookId);
  if (!family.some((def) => def.id === current.id)) family.push(current);
  return family.sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
}

/** What switching a node to another version changes on the canvas. */
export interface VersionDiff {
  removedInputs: string[];
  removedOutputs: string[];
  addedInputs: string[];
  addedOutputs: string[];
  /** Ports kept by name whose tuple shape changed; their links are re-checked. */
  changedPorts: string[];
}

const shape = (port: { elements: { kind: string }[] }) => port.elements.map((element) => element.kind).join(",");

export function versionDiff(from: ModuleDef, to: ModuleDef): VersionDiff {
  const names = (ports: { name: string }[]) => new Set(ports.map((port) => port.name));
  const [fromIn, toIn, fromOut, toOut] = [names(from.inputs), names(to.inputs), names(from.outputs), names(to.outputs)];
  const changed = [...from.inputs, ...from.outputs].filter((port) => {
    const next = [...to.inputs, ...to.outputs].find((candidate) => candidate.name === port.name);
    return next && shape(next) !== shape(port);
  }).map((port) => port.name);
  return {
    removedInputs: [...fromIn].filter((name) => !toIn.has(name)),
    removedOutputs: [...fromOut].filter((name) => !toOut.has(name)),
    addedInputs: [...toIn].filter((name) => !fromIn.has(name)),
    addedOutputs: [...toOut].filter((name) => !fromOut.has(name)),
    changedPorts: changed,
  };
}
