"use client";

import { createEditorStore, type EditorStore } from "@/features/editor/store";
import { createNotebookSession, type NotebookSession } from "@/features/notebook/session";
import { windowProject } from "@/features/workspace/window-project";
import { api } from "@/lib/api";
import type { WorkflowDoc } from "@/features/workflow/types";
import { getEditorSaveSession } from "@/features/editor/editor-save";
import { createStore } from "zustand/vanilla";
import type { TextDocument } from "@/features/workspace/document-queries";
import type { FileMove } from "@/features/workspace/reference-updates";

const workflows = new Map<string, EditorStore>();
const notebooks = new Map<string, NotebookSession>();
interface TextState { saved?: TextDocument; draft?: string; saving: boolean; error?: string; paused?: boolean }
const texts = new Map<string, ReturnType<typeof createTextSession>>();
const key = (id: string) => `${windowProject() ?? "preview"}:${id}`;

export function moveTextDocuments(moves: FileMove[]) {
  const prefix = key("file/");
  for (const [identity, session] of [...texts]) {
    if (!identity.startsWith(prefix)) continue;
    const path = decodeURIComponent(identity.slice(prefix.length));
    const move = moves.find(({ from }) => path === from || path.startsWith(`${from}/`));
    if (!move || move.from === move.to) continue;
    const next = `${move.to}${path.slice(move.from.length)}`;
    texts.delete(identity);
    texts.set(key(`file/${encodeURIComponent(next)}`), session);
    session.setState((state) => ({ saved: state.saved ? { ...state.saved, path: next } : undefined }));
  }
}

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
  if (tab.startsWith("file/")) return texts.get(key(tab))?.getState().draft !== undefined;
  if (tab.startsWith("workflow/")) {
    const state = workflows.get(key(tab.slice(9)))?.getState();
    return !!state && state.revision !== state.savedRevision;
  }
  return !!notebooks.get(key(tab))?.store.getState().draft;
}

export function forgetDocument(tab: string) {
  if (tab.startsWith("file/")) texts.delete(key(tab));
  else if (tab.startsWith("workflow/")) workflows.delete(key(tab.slice(9)));
  else { notebooks.get(key(tab))?.dispose(); notebooks.delete(key(tab)); }
}

export function pauseDocument(tab: string, paused: boolean) {
  if (tab.startsWith("file/")) textSession(decodeURIComponent(tab.slice(5))).setState({ paused });
  else if (tab.startsWith("workflow/")) workflowSession(tab.slice(9)).setState({ autosavePaused: paused });
  else notebookSession(tab).pauseAutosave(paused);
}

export function subscribeDocument(tab: string, listener: () => void) {
  if (tab.startsWith("file/")) return textSession(decodeURIComponent(tab.slice(5))).subscribe(listener);
  return tab.startsWith("workflow/") ? workflowSession(tab.slice(9)).subscribe(listener) : notebookSession(tab).store.subscribe(listener);
}

export async function saveDocument(tab: string) {
  if (tab.startsWith("file/")) { await saveTextDocument(decodeURIComponent(tab.slice(5))); return; }
  if (tab.startsWith("workflow/")) {
    const session = workflowSession(tab.slice(9));
    await getEditorSaveSession(session).editorSaveSettled();
    const state = session.getState();
    const revision = state.revision;
    const saved = await api<WorkflowDoc>(`/workflows/${state.docId}`, { method: "PUT", body: JSON.stringify(state.toDoc()) });
    session.setState({ fileVersion: saved.fileVersion, updatedAt: saved.updatedAt, savedRevision: revision });
  } else await notebookSession(tab).flush();
}

function createTextSession() { return createStore<TextState>(() => ({ saving: false })); }
export function textSession(path: string) {
  const identity = key(`file/${encodeURIComponent(path)}`);
  let session = texts.get(identity);
  if (!session) { session = createTextSession(); texts.set(identity, session); }
  return session;
}
export async function saveTextDocument(path: string, expected?: string) {
  const session = textSession(path);
  const state = session.getState();
  if (state.draft === undefined || state.saving) return;
  if (state.error && !expected) throw new Error(state.error);
  session.setState({ saving: true, error: undefined });
  try {
    const saved = await api<TextDocument>(`/documents?path=${encodeURIComponent(path)}`, { method: "PUT", body: JSON.stringify({ content: state.draft, version: expected ?? state.saved?.version }) });
    session.setState((current) => ({ saved, draft: current.draft === saved.content ? undefined : current.draft }));
  } catch (error) {
    session.setState({ error: error instanceof Error ? error.message : "保存失败" });
    throw error;
  } finally { session.setState({ saving: false }); }
}
