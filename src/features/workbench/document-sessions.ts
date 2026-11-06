"use client";

import { createEditorStore, type EditorStore } from "@/features/editor/store";
import { createNotebookSession, type NotebookSession } from "@/features/notebook/session";
import { windowProject } from "@/features/workspace/window-project";

const workflows = new Map<string, EditorStore>();
const notebooks = new Map<string, NotebookSession>();
const key = (id: string) => `${windowProject() ?? "preview"}:${id}`;

export function workflowSession(id: string): EditorStore {
  const identity = key(id);
  let session = workflows.get(identity);
  if (!session) { session = createEditorStore(); workflows.set(identity, session); }
  return session;
}

export function notebookSession(id: string): NotebookSession {
  const identity = key(id);
  let session = notebooks.get(identity);
  if (!session) { session = createNotebookSession({ notebookId: id }); notebooks.set(identity, session); }
  return session;
}

export function dirtyDocument(tab: string): boolean {
  if (tab.startsWith("workflow/")) {
    const state = workflows.get(key(tab.slice(9)))?.getState();
    return !!state && state.revision !== state.savedRevision;
  }
  return !!notebooks.get(key(tab))?.store.getState().draft;
}

export function forgetDocument(tab: string) {
  if (tab.startsWith("workflow/")) workflows.delete(key(tab.slice(9)));
  else { notebooks.get(key(tab))?.dispose(); notebooks.delete(key(tab)); }
}
