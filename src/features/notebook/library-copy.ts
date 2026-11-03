import type { ModuleDef } from "@/features/workflow/types";

import { PercentError, readPercent, writePercent } from "./jupytext";
import type { NotebookDoc } from "./types";

/** The jupytext pair stored with a module exported from a notebook: what "edit" opens again. */
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
  savedAt: string;
}

const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;
const CELL_MAX = 80;
const SOURCE_MAX = 50_000;

export function buildLibraryCopy(input: {
  notebook: Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells">;
  module: ModuleDef;
  savedAt?: string;
}): ModuleLibraryCopy {
  return {
    moduleId: input.module.id,
    version: input.module.version ?? "v1",
    format: "jupytext-percent",
    formatVersion: "1.3",
    percent: writePercent(input.notebook),
    script: input.module.script ?? "",
    command: input.module.command ?? "",
    savedAt: input.savedAt ?? new Date().toISOString(),
  };
}

/** A temporary notebook to edit the module in. Saving it to the project and exporting it again are both up to the user. */
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
    temporary: true,
    fromModuleId: copy.moduleId,
  };
}
