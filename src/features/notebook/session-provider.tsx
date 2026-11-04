"use client";

import * as React from "react";
import { useStore } from "zustand";

import { useNotebook, useRunNotebook, useSaveNotebook } from "./queries";
import { createNotebookSession, type NotebookSession, type NotebookSessionState } from "./session";

const NotebookSessionContext = React.createContext<NotebookSession | null>(null);

/**
 * Opens one notebook session and keeps it in step with the notebook query.
 * The editor and the assistant are both children; neither owns the document.
 */
export function NotebookSessionProvider({ notebookId, children }: { notebookId: string; children: React.ReactNode }) {
  const notebook = useNotebook(notebookId);
  const save = useSaveNotebook();
  const run = useRunNotebook();
  const saveAsync = save.mutateAsync;
  const runAsync = run.mutateAsync;
  const [session] = React.useState(() =>
    createNotebookSession({ notebookId, saved: notebook.data ?? null, ports: { save: saveAsync, run: runAsync } }),
  );

  React.useLayoutEffect(() => {
    session.connect({ save: saveAsync, run: runAsync });
  }, [session, saveAsync, runAsync]);
  React.useLayoutEffect(() => {
    if (notebook.data) session.setSaved(notebook.data);
  }, [session, notebook.data]);
  React.useEffect(() => () => session.dispose(), [session]);

  return <NotebookSessionContext value={session}>{children}</NotebookSessionContext>;
}

export function useNotebookSession(): NotebookSession {
  const session = React.useContext(NotebookSessionContext);
  if (!session) throw new Error("Notebook components require a NotebookSessionProvider");
  return session;
}

export function useNotebookSessionState<T>(select: (state: NotebookSessionState) => T): T {
  return useStore(useNotebookSession().store, select);
}

/** Draft if dirty, else the saved copy; re-renders on every edit. */
export function useNotebookDoc() {
  return useNotebookSessionState((state) => state.draft ?? state.saved);
}
