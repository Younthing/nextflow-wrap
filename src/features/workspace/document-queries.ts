"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NotebookDoc } from "@/features/notebook/types";
import type { WorkflowDoc } from "@/features/workflow/types";
import { windowProject } from "./window-project";

export interface TextDocument { path: string; content: string; version: string }
export const documentKey = (path: string) => ["documents", windowProject(), path] as const;
export function useTextDocument(path: string) {
  const project = windowProject();
  return useQuery({ queryKey: documentKey(path), queryFn: () => api<TextDocument>(`/documents?project=${project}&path=${encodeURIComponent(path)}`) });
}
export function useWriteDocument(path: string) {
  const qc = useQueryClient();
  const project = windowProject();
  return useMutation({
    mutationFn: (body: { content: string; version: string | null }) => api<TextDocument>(`/documents?project=${project}&path=${encodeURIComponent(path)}`, { method: "PUT", headers: { "x-project-id": project ?? "" }, body: JSON.stringify(body) }),
    onSuccess: (doc) => { qc.setQueryData(documentKey(path), doc); void qc.invalidateQueries({ queryKey: ["fs"] }); },
  });
}
export function useOpenDocument() {
  const project = windowProject();
  return useMutation({ mutationFn: (path: string) => api<NotebookDoc | WorkflowDoc>(`/documents/open?project=${project}&path=${encodeURIComponent(path)}`) });
}
