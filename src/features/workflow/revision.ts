/**
 * `updatedAt` is the workflow revision the API already stores.
 * A PUT echoes the revision it read; the server keeps the write only when that
 * revision is still current, then mints a new one.
 */
export function workflowWriteIsStale(
  current: { updatedAt: string } | undefined,
  incoming: { updatedAt: string },
): boolean {
  return current != null && current.updatedAt !== incoming.updatedAt;
}

/**
 * Dirty canvas edits stay only when they were made against the revision the
 * server (or its cache) still has. A newer revision — a library rename that
 * won the race — replaces them.
 */
export function keepLocalWorkflowEdits(
  local: { docId: string; updatedAt: string; dirty: boolean },
  server: { id: string; updatedAt: string },
): boolean {
  return local.dirty && local.docId === server.id && local.updatedAt === server.updatedAt;
}
