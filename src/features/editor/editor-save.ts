import { ApiError } from "@/lib/api";
import type { WorkflowDoc } from "@/features/workflow/types";
import type { Issue } from "@/features/workflow/validate";

import { saveConfirmation } from "./save-feedback";

let tail: Promise<void> = Promise.resolve();
let announce = false;
/** Latest revision this editor itself stored, per workflow. Opening another workflow must not erase it. */
const saveAck = new Map<string, string>();

/** Record a revision this editor successfully wrote. */
export function noteEditorRevision(id: string, updatedAt: string) {
  saveAck.set(id, updatedAt);
}

/**
 * A 409 is our own preceding save when the server is already at the revision
 * that save acknowledged. Local edits on top of that revision stay put.
 */
export function editorConflictIsOwnWrite(id: string, serverUpdatedAt: string): boolean {
  return saveAck.get(id) === serverUpdatedAt;
}

/** Keep the captured document. Only its server revision moves forward after our own save of the same workflow. */
export function withAcknowledgedRevision(snapshot: EditorSaveRead): EditorSaveRead {
  const ack = snapshot.docId ? saveAck.get(snapshot.docId) : undefined;
  if (!ack || ack === snapshot.doc.updatedAt || ack < snapshot.doc.updatedAt) return snapshot;
  return { ...snapshot, doc: { ...snapshot.doc, updatedAt: ack } };
}

export function enqueueEditorSave(silent: boolean, task: (announceSave: boolean) => Promise<void>): void {
  if (!silent) announce = true;
  tail = tail.then(async () => {
    const loud = announce;
    announce = false;
    await task(loud);
  }).catch(() => {});
}

export function editorSaveSettled(): Promise<void> {
  return tail;
}

export function resetEditorSaveQueueForTests() {
  tail = Promise.resolve();
  announce = false;
  saveAck.clear();
}

export type EditorSaveRead = {
  docId: string;
  revision: number;
  generation: number;
  dirty: boolean;
  doc: WorkflowDoc;
  issues: readonly Pick<Issue, "level">[];
};

/**
 * One save at a time. The snapshot is the document captured when the save was
 * enqueued. A follow-up for the same workflow replaces only `updatedAt` with
 * the revision the previous success stored.
 */
export async function runEditorSave(args: {
  announce: boolean;
  snapshot: EditorSaveRead;
  save: (doc: WorkflowDoc) => Promise<WorkflowDoc>;
  markSaved: (revision: number, updatedAt: string) => void;
  stillOpen: (generation: number, docId: string) => boolean;
  fetchCurrent: (id: string) => Promise<WorkflowDoc>;
  load: (doc: WorkflowDoc) => void;
  toastSaved: (tone: "success" | "warning", message: string) => void;
  toastError: (message: string) => void;
}): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = withAcknowledgedRevision(args.snapshot);
    if (!state.docId || !state.dirty) {
      if (args.announce && state.docId) args.toastSaved("success", "已保存");
      return;
    }
    const confirmation = saveConfirmation(state.issues);
    try {
      const saved = await args.save(state.doc);
      // Record the ack even if another workflow is now open, so a queued
      // follow-up for this id can send that revision. Do not mark the shared
      // store saved unless this document is still the one on screen.
      noteEditorRevision(saved.id, saved.updatedAt);
      if (!args.stillOpen(state.generation, saved.id)) return;
      args.markSaved(state.revision, saved.updatedAt);
      if (args.announce) args.toastSaved(confirmation.tone, confirmation.message);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const current = await args.fetchCurrent(state.docId);
        if (editorConflictIsOwnWrite(state.docId, current.updatedAt)) continue;
        if (args.stillOpen(state.generation, state.docId)) args.load(current);
        return;
      }
      const message = err instanceof Error ? err.message : "保存失败";
      args.toastError(`保存失败：${message}`);
      return;
    }
  }
}
