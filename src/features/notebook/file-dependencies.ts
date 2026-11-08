import type { NotebookDoc } from "./types";

/** Advisory only: arbitrary Python/R code is not rewritten or treated as a complete dependency graph. */
export function literalFileDependencies(notebook: Pick<NotebookDoc, "cells">): string[] {
  const paths = new Set<string>();
  for (const cell of notebook.cells) {
    if (cell.role !== "code") continue;
    for (const match of cell.source.matchAll(/(?:open|read_csv|read_table|read_h5ad|readRDS|read\.csv|Path)\(\s*["']([^"'\n]+)["']([^\n)]*)/g)) {
      if (/^\s*,\s*["'][wax]/.test(match[2])) continue;
      if (match[1].includes("/") || /\.(?:csv|tsv|h5ad|fq|fastq|bam|tif|tiff|rds)$/i.test(match[1])) paths.add(match[1]);
    }
  }
  return [...paths];
}
