import { BUILTIN_MODULES, REFERENCE_ID, withReferenceFormat } from "./builtins";
import type { ModuleDef, WorkflowNodeData } from "./types";

export type ModuleIndex = Map<string, ModuleDef>;

export function indexModules(modules: ModuleDef[]): ModuleIndex {
  return new Map([...BUILTIN_MODULES, ...modules].map((m) => [m.id, m]));
}

/** The effective definition of a node, including built-in node settings. */
export function resolveNodeDef(
  index: ModuleIndex,
  data: Pick<WorkflowNodeData, "moduleId" | "settings">,
): ModuleDef | undefined {
  const def = index.get(data.moduleId);
  if (!def) return undefined;
  if (def.id === REFERENCE_ID) {
    return withReferenceFormat(def, data.settings?.format as string | undefined);
  }
  return def;
}

export function searchModules(modules: ModuleDef[], query: string): ModuleDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return modules;
  const scored = modules
    .map((m) => {
      const hay = [m.name, m.process, m.path, m.category, m.description, ...m.keywords, ...m.tools.map((t) => t.name)]
        .join(" ")
        .toLowerCase();
      let score = 0;
      if (m.name.toLowerCase().startsWith(q) || m.process.toLowerCase().startsWith(q)) score += 10;
      if (m.name.toLowerCase().includes(q)) score += 5;
      if (hay.includes(q)) score += 1;
      return { m, score };
    })
    .filter((x) => x.score > 0);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.m);
}

export function groupByCategory(modules: ModuleDef[]): [string, ModuleDef[]][] {
  const groups = new Map<string, ModuleDef[]>();
  for (const m of modules) {
    const list = groups.get(m.category) ?? [];
    list.push(m);
    groups.set(m.category, list);
  }
  return [...groups.entries()];
}
