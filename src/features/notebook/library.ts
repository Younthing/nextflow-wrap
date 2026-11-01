import { countCellChanges } from "./changes";
import type { NotebookCell, NotebookDoc, NotebookRevision, NotebookSummary } from "./types";
import type { ModuleDef } from "@/features/workflow/types";
import { versionNumber } from "@/features/workflow/origin";

export function latestModuleForNotebook(modules: readonly ModuleDef[], notebookId: string): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  for (const mod of modules) {
    if (mod.sourceNotebookId !== notebookId) continue;
    if (!best || versionNumber(mod.version) >= versionNumber(best.version)) best = mod;
  }
  return best;
}

export function summarizeNotebook(doc: NotebookDoc, modules: readonly ModuleDef[]): NotebookSummary {
  const published = latestModuleForNotebook(modules, doc.id);
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    kernel: doc.kernel,
    language: doc.language,
    rev: doc.rev,
    updatedAt: doc.updatedAt,
    publishState: published ? "published" : "analysis",
    publishedVersion: published?.version,
    tryRun: published?.tryRun,
    moduleName: published?.name,
    moduleId: published?.id,
    fromLibrary: Boolean(doc.libraryModuleId),
  };
}

export type NotebookFilter = "all" | "analysis" | "published";

export function filterNotebooks(rows: readonly NotebookSummary[], filter: NotebookFilter, query: string): NotebookSummary[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "analysis" && row.publishState !== "analysis") return false;
    if (filter === "published" && row.publishState !== "published") return false;
    if (!needle) return true;
    return row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle) || (row.moduleName?.toLowerCase().includes(needle) ?? false);
  });
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
  sourceNotebookName: string;
  sourceNotebookRevCurrent?: number;
  sourceChanged: boolean;
  cellChanges: number;
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
  notebooks: readonly NotebookDoc[],
  revisions: readonly NotebookRevision[],
  workflows: readonly { nodes: readonly { data: { moduleId: string } }[] }[],
): ScriptModuleView[] {
  const notes = new Map(notebooks.map((doc) => [doc.id, doc]));
  const counts = referenceCounts(workflows);
  return modules
    .filter((mod) => mod.origin === "script" || mod.id.startsWith("script/"))
    .map((mod) => {
      const notebook = mod.sourceNotebookId ? notes.get(mod.sourceNotebookId) : undefined;
      const pinned = revisions.find((rev) => rev.notebookId === mod.sourceNotebookId && rev.rev === mod.sourceNotebookRev);
      const cellChanges = notebook && pinned ? countCellChanges(pinned.cells, notebook.cells) : 0;
      const sourceChanged = !!notebook && mod.sourceNotebookRev !== undefined && notebook.rev !== mod.sourceNotebookRev;
      return {
        ...mod,
        sourceNotebookName: notebook?.name ?? "源笔记本已删除",
        sourceNotebookRevCurrent: notebook?.rev,
        sourceChanged,
        cellChanges,
        referenceCount: counts[mod.id] ?? 0,
      };
    });
}

export function emptyCodeCell(id: string): NotebookCell {
  return { id, role: "code", source: "" };
}
