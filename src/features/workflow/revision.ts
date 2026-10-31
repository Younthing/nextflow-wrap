import type { WorkflowDoc } from "./types";

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

export type WorkflowPutResult =
  | { status: "ok"; doc: WorkflowDoc }
  | { status: "missing" }
  | { status: "stale" };

/** Read the stored row, compare its revision, then build the next document. Call inside one transaction. */
export function commitWorkflowPut(
  current: WorkflowDoc | undefined,
  incoming: WorkflowDoc,
  now = new Date().toISOString(),
): WorkflowPutResult {
  if (!current) return { status: "missing" };
  if (workflowWriteIsStale(current, incoming)) return { status: "stale" };
  return { status: "ok", doc: { ...incoming, updatedAt: nextWorkflowRevision(current.updatedAt, now) } };
}

/**
 * A successful write must move the token forward. Wall-clock time can repeat
 * the stored millisecond, which would let the pre-write document pass the next check.
 */
export function nextWorkflowRevision(current: string | undefined, now = new Date().toISOString()): string {
  if (!current || now > current) return now;
  const parsed = Date.parse(current);
  if (Number.isNaN(parsed)) return `${current}\u0001`;
  return new Date(parsed + 1).toISOString();
}

/** True when `incoming` sorts before a revision the editor already holds. */
export function revisionIsOlder(incoming: string, baseline: string | undefined): boolean {
  return baseline != null && incoming < baseline;
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
