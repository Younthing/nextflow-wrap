import { ApiError } from "@/lib/api";
import type { WorkflowDoc } from "@/features/workflow/types";
import type { Issue } from "@/features/workflow/validate";

import { saveConfirmation } from "./save-feedback";

let tail: Promise<void> = Promise.resolve();
let announce = false;
let acknowledged: { id: string; updatedAt: string } | null = null;

/** Last revision this editor successfully stored, or the one it last loaded. */
export function noteEditorRevision(id: string, updatedAt: string) {
  acknowledged = { id, updatedAt };
}

/**
 * A 409 is our own preceding save when the server is already at the revision
 * that save acknowledged. Local edits on top of that revision stay put.
 */
export function editorConflictIsOwnWrite(id: string, serverUpdatedAt: string): boolean {
  return acknowledged?.id === id && acknowledged.updatedAt === serverUpdatedAt;
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
  acknowledged = null;
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
 * One save at a time. A follow-up save reads the store after the previous
 * success, so it sends that revision instead of repeating the one already used.
 */
export async function runEditorSave(args: {
  announce: boolean;
  read: () => EditorSaveRead;
  save: (doc: WorkflowDoc) => Promise<WorkflowDoc>;
  markSaved: (revision: number, updatedAt: string) => void;
  stillOpen: (generation: number, docId: string) => boolean;
  fetchCurrent: (id: string) => Promise<WorkflowDoc>;
  load: (doc: WorkflowDoc) => void;
  toastSaved: (tone: "success" | "warning", message: string) => void;
  toastError: (message: string) => void;
}): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = args.read();
    if (!state.docId || !state.dirty) {
      if (args.announce && state.docId) args.toastSaved("success", "已保存");
      return;
    }
    const confirmation = saveConfirmation(state.issues);
    try {
      const saved = await args.save(state.doc);
      if (!args.stillOpen(state.generation, saved.id)) return;
      args.markSaved(state.revision, saved.updatedAt);
      noteEditorRevision(saved.id, saved.updatedAt);
      if (args.announce) args.toastSaved(confirmation.tone, confirmation.message);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const current = await args.fetchCurrent(state.docId);
        if (editorConflictIsOwnWrite(state.docId, current.updatedAt)) continue;
        if (args.stillOpen(state.generation, state.docId)) {
          args.load(current);
          noteEditorRevision(current.id, current.updatedAt);
        }
        return;
      }
      const message = err instanceof Error ? err.message : "保存失败";
      args.toastError(`保存失败：${message}`);
      return;
    }
  }
}
