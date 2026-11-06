"use client";

import * as React from "react";
import { useStore } from "zustand";

import { fetchNotebookVariable, fetchNotebookVariables, useKernelInfo, useNotebook, useRunNotebook, useSaveNotebook } from "./queries";
import { notebookSession } from "@/features/workbench/document-sessions";
import { type NotebookSession, type NotebookSessionState } from "./session";

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
  const ports = React.useMemo(
    () => ({ save: saveAsync, run: runAsync, variables: fetchNotebookVariables, variable: fetchNotebookVariable }),
    [saveAsync, runAsync],
  );
  const [session] = React.useState(() => notebookSession(notebookId));
  const language = notebook.data?.language;
  const kernel = useKernelInfo(notebookId, language === "python").data;

  React.useLayoutEffect(() => {
    session.connect(ports);
  }, [session, ports]);
  React.useLayoutEffect(() => {
    if (notebook.data) session.setSaved(notebook.data);
  }, [session, notebook.data]);

  // Re-read variables whenever the kernel settles: after a run, a restart, or a shutdown from the toolbar.
  const kernelState = kernel?.state;
  const kernelStarted = kernel?.startedAt;
  React.useEffect(() => {
    if (!language || kernelState === "busy" || kernelState === "starting") return;
    if (language === "python" && kernelState === undefined) return;
    void session.refreshVariables();
  }, [session, language, kernelState, kernelStarted]);

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
