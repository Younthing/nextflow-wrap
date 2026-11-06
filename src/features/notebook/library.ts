import type { NotebookDoc, NotebookSummary } from "./types";
import type { ModuleDef } from "@/features/workflow/types";

export function summarizeNotebook(doc: NotebookDoc): NotebookSummary {
  return {
    id: doc.id,
    filePath: doc.filePath,
    name: doc.name,
    description: doc.description,
    kernel: doc.kernel,
    language: doc.language,
    rev: doc.rev,
    updatedAt: doc.updatedAt,
    projectId: doc.projectId,
  };
}

export function formatRelative(iso: string, now = Date.now()): string {
  const delta = now - Date.parse(iso);
  if (!Number.isFinite(delta)) return "—";
  const min = Math.round(delta / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export interface ScriptModuleView extends ModuleDef {
  /** Workflows that use the module. */
  referenceCount: number;
}

export function referenceCounts(workflows: readonly { nodes: readonly { data: { moduleId: string } }[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const workflow of workflows) {
    const seen = new Set<string>();
    for (const node of workflow.nodes) {
      if (seen.has(node.data.moduleId)) continue;
      seen.add(node.data.moduleId);
      counts[node.data.moduleId] = (counts[node.data.moduleId] ?? 0) + 1;
    }
  }
  return counts;
}

export function scriptModuleViews(
  modules: readonly ModuleDef[],
  workflows: readonly { nodes: readonly { data: { moduleId: string } }[] }[],
): ScriptModuleView[] {
  const counts = referenceCounts(workflows);
  return modules
    .filter((mod) => mod.origin === "script" || mod.id.startsWith("script/"))
    .map((mod) => ({ ...mod, referenceCount: counts[mod.id] ?? 0 }));
}
