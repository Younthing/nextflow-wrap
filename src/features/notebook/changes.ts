import type { NotebookCell } from "./types";

/** How many cells differ between the pinned publish snapshot and the notebook now. */
export function countCellChanges(pinned: readonly NotebookCell[], latest: readonly NotebookCell[]): number {
  const byId = new Map(latest.map((cell) => [cell.id, cell]));
  const seen = new Set<string>();
  let changes = 0;
  for (const cell of pinned) {
    seen.add(cell.id);
    const next = byId.get(cell.id);
    if (!next || next.source !== cell.source || next.role !== cell.role) changes += 1;
  }
  for (const cell of latest) {
    if (!seen.has(cell.id)) changes += 1;
  }
  return changes;
}
