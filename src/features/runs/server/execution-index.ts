import catalog from "@/data/nf-core-modules.json";
import { indexModules, type ModuleIndex } from "@/features/workflow/catalog";
import type { ModuleCatalog, ModuleDef } from "@/features/workflow/types";

/**
 * Modules a real launch can resolve.
 * Published notebooks live in the studio database, not in the nf-core catalog.
 * Submit and the runner both rebuild the project, so they must share this index.
 * A script node otherwise fails as an unknown module before Nextflow starts.
 */
export function executionModuleIndex(scriptModules: readonly ModuleDef[]): ModuleIndex {
  return indexModules([...(catalog as ModuleCatalog).modules, ...scriptModules]);
}
