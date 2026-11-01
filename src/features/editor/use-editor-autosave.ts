"use client";

import * as React from "react";
import { useSaveWorkflow, fetchWorkflow } from "@/features/workflow/queries";
import { getEditorSaveSession, type EditorSaveRead } from "./editor-save";
import { selectIsDirty } from "./store";
import { useEditorStore, useEditorStoreApi } from "./editor-provider";
import { editorIssues } from "./issues";
import { toast } from "@/lib/toast";

const AUTOSAVE_MS = 1500;

/** Saves captured revisions, serializes requests and flushes a dirty document on unmount. */
export function useEditorAutosave() {
  const store = useEditorStoreApi();
  const { mutateAsync, isPending } = useSaveWorkflow(store);
  const session = getEditorSaveSession(store);
  const docId = useEditorStore((s) => s.docId);
  const revision = useEditorStore((s) => s.revision);
  const dirty = useEditorStore(selectIsDirty);
  const doSave = React.useCallback(
    (silent = false) => {
      // Capture this workflow now. A queued save must not read whatever document
      // is in the shared store when the previous request finally finishes.
      const state = store.getState();
      const snapshot: EditorSaveRead = {
        docId: state.docId,
        revision: state.revision,
        generation: state.generation,
        dirty: selectIsDirty(state),
        doc: state.toDoc(),
        issues: editorIssues(state),
      };
      session.enqueueEditorSave(silent, (announce) =>
        session.runEditorSave({
          announce,
          snapshot,
          save: mutateAsync,
          markSaved: (revision, updatedAt) =>
            store.getState().markSaved(revision, updatedAt),
          stillOpen: (generation, docId) => {
            const current = store.getState();
            return current.generation === generation && current.docId === docId;
          },
          fetchCurrent: fetchWorkflow,
          load: (doc) => store.getState().load(doc),
          toastSaved: (tone, message) =>
            tone === "warning"
              ? toast.warning(message)
              : toast.success(message),
          toastError: (message) => toast.error(message),
        }),
      );
    },
    [mutateAsync, store, session],
  );

  // Autosave saved workflows shortly after each edit, like ComfyUI does.
  React.useEffect(() => {
    if (!dirty || !docId) return;
    const t = setTimeout(() => doSave(true), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, docId, revision, doSave]);

  const doSaveRef = React.useRef(doSave);
  React.useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);
  React.useEffect(() => {
    return () => {
      const state = store.getState();
      if (selectIsDirty(state) && state.docId) doSaveRef.current(true);
    };
  }, [store]);

  return { doSave, saving: isPending };
}
