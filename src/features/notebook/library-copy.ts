import type { ModuleDef } from "@/features/workflow/types";

import { PercentError, readPercent, writePercent, type PercentProvenance } from "./jupytext";
import type { NotebookDoc, NotebookRevision } from "./types";

/** Versioned jupytext pair stored for one published script module. */
export interface ModuleLibraryCopy {
  moduleId: string;
  version: string;
  format: "jupytext-percent";
  formatVersion: "1.3";
  /** Percent-format notebook. Round-trips to cells, including ones the CLI drops. */
  percent: string;
  /** Generated CLI paired with `percent`. Nextflow calls this, not the percent text. */
  script: string;
  command: string;
  sourceNotebookId: string;
  sourceNotebookRev: number;
  savedAt: string;
}

const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;
const CELL_MAX = 80;
const SOURCE_MAX = 50_000;

export function buildLibraryCopy(input: {
  notebook: NotebookDoc;
  module: ModuleDef;
  savedAt?: string;
}): ModuleLibraryCopy {
  if (!input.module.sourceNotebookId || input.module.sourceNotebookRev === undefined) {
    throw new Error("脚本模块缺少源笔记本");
  }
  const provenance: PercentProvenance = {
    sourceNotebookId: input.module.sourceNotebookId,
    sourceNotebookRev: input.module.sourceNotebookRev,
  };
  return {
    moduleId: input.module.id,
    version: input.module.version ?? "v1",
    format: "jupytext-percent",
    formatVersion: "1.3",
    percent: writePercent(input.notebook, provenance),
    script: input.module.script ?? "",
    command: input.module.command ?? "",
    sourceNotebookId: input.module.sourceNotebookId,
    sourceNotebookRev: input.module.sourceNotebookRev,
    savedAt: input.savedAt ?? new Date().toISOString(),
  };
}

/** Rebuild a stored copy from the pinned revision. Drifted notebooks are not used as a stand-in. */
export function libraryCopyFromRevision(
  module: ModuleDef,
  notebook: NotebookDoc | undefined,
  revision: NotebookRevision | undefined,
  savedAt = new Date().toISOString(),
): ModuleLibraryCopy | undefined {
  if (!module.sourceNotebookId || module.sourceNotebookRev === undefined || !notebook) return undefined;
  if (notebook.id !== module.sourceNotebookId) return undefined;
  const pinned = revision && revision.notebookId === notebook.id && revision.rev === module.sourceNotebookRev
    ? revision.cells
    : notebook.rev === module.sourceNotebookRev
      ? notebook.cells
      : undefined;
  if (!pinned) return undefined;
  return buildLibraryCopy({
    notebook: { ...notebook, cells: pinned, rev: module.sourceNotebookRev },
    module,
    savedAt: revision?.savedAt ?? savedAt,
  });
}

export function storedLibraryCopy(
  moduleId: string,
  stored: ModuleLibraryCopy | undefined,
  module: ModuleDef | undefined,
  notebook: NotebookDoc | undefined,
  revision: NotebookRevision | undefined,
): ModuleLibraryCopy | undefined {
  if (stored && stored.moduleId === moduleId && stored.format === "jupytext-percent") return stored;
  if (!module || module.id !== moduleId) return undefined;
  return libraryCopyFromRevision(module, notebook, revision);
}

/** New editable notebook. The id is the caller's; the source notebook is not part of this value. */
export function notebookFromLibrary(copy: ModuleLibraryCopy, id: string, now = new Date().toISOString()): NotebookDoc {
  if (copy.format !== "jupytext-percent") throw new PercentError("不认识的库副本格式");
  const parsed = readPercent(copy.percent);
  if (parsed.cells.length === 0 || parsed.cells.length > CELL_MAX) throw new PercentError("单元格数量无效");
  if (parsed.cells.some((cell) => cell.source.length > SOURCE_MAX)) throw new PercentError("单元格过长");
  return {
    id,
    name: parsed.name.trim().slice(0, NAME_MAX) || "未命名笔记本",
    description: parsed.description.slice(0, DESCRIPTION_MAX),
    kernel: parsed.kernel,
    language: parsed.language,
    cells: parsed.cells,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    libraryModuleId: copy.moduleId,
    librarySourceNotebookId: copy.sourceNotebookId,
    librarySourceNotebookRev: copy.sourceNotebookRev,
  };
}
