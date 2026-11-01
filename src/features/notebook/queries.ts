"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ModuleDef } from "@/features/workflow/types";
import type { ScriptModuleView } from "./library";
import type { PortBindingRequest } from "./input-bindings";
import type { KernelInfo, KernelSpecList, NotebookDoc, NotebookRevision, NotebookRunResult, NotebookSummary, TryRunRecord } from "./types";

export const notebookKeys = {
  all: ["notebooks"] as const,
  detail: (id: string) => ["notebooks", id] as const,
  revision: (id: string, rev: string) => ["notebooks", id, "rev", rev] as const,
  kernel: (id: string) => ["notebooks", id, "kernel"] as const,
};

export const kernelSpecsKey = ["kernels"] as const;

export const scriptModuleKey = ["script-modules"] as const;

export interface ScriptModuleList {
  modules: ScriptModuleView[];
  references: Record<string, number>;
}

export function useNotebooks() {
  return useQuery({
    queryKey: notebookKeys.all,
    queryFn: () => api<NotebookSummary[]>("/notebooks"),
  });
}

export function useNotebook(id: string | undefined) {
  return useQuery({
    queryKey: notebookKeys.detail(id ?? ""),
    queryFn: () => api<NotebookDoc>(`/notebooks/${id}`),
    enabled: !!id,
  });
}

export function useNotebookRevision(id: string | undefined, rev: string | null) {
  return useQuery({
    queryKey: notebookKeys.revision(id ?? "", rev ?? ""),
    queryFn: () => api<NotebookRevision>(`/notebooks/${id}/revisions/${rev}`),
    enabled: !!id && !!rev,
  });
}

export function useScriptModules() {
  return useQuery({
    queryKey: scriptModuleKey,
    queryFn: () => api<ScriptModuleList>("/script-modules"),
  });
}

function refreshNotebooks(qc: ReturnType<typeof useQueryClient>, doc?: NotebookDoc) {
  if (doc) qc.setQueryData(notebookKeys.detail(doc.id), doc);
  void qc.invalidateQueries({ queryKey: notebookKeys.all });
  void qc.invalidateQueries({ queryKey: scriptModuleKey });
}

export function useCreateNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<NotebookDoc, "name" | "description" | "kernel" | "cells">) =>
      api<NotebookDoc>("/notebooks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (doc) => refreshNotebooks(qc, doc),
  });
}

export function useSaveNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: NotebookDoc) =>
      api<NotebookDoc>(`/notebooks/${doc.id}`, { method: "PUT", body: JSON.stringify(doc) }),
    onSuccess: (doc) => refreshNotebooks(qc, doc),
  });
}

export function useRunNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cellId }: { id: string; cellId?: string }) =>
      api<NotebookRunResult>(`/notebooks/${id}/run`, {
        method: "POST",
        body: JSON.stringify(cellId ? { cellId } : {}),
      }),
    onMutate: ({ id }) => {
      // The kernel turns busy on the server; show it without waiting for the next poll.
      qc.setQueryData<KernelInfo>(notebookKeys.kernel(id), (current) => ({ notebookId: id, ...current, state: "busy" }));
    },
    onSettled: (_data, _error, { id }) => qc.invalidateQueries({ queryKey: notebookKeys.kernel(id) }),
  });
}

/** The notebook's persistent kernel. Polls while it starts or runs so the toolbar can offer interrupt. */
export function useKernelInfo(id: string, enabled = true) {
  return useQuery({
    queryKey: notebookKeys.kernel(id),
    queryFn: () => api<KernelInfo>(`/notebooks/${id}/kernel`),
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "busy" || state === "starting" ? 2_000 : false;
    },
  });
}

export function useKernelAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "interrupt" | "restart" | "shutdown" }) =>
      api<KernelInfo>(`/notebooks/${id}/kernel`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: (info, { id }) => qc.setQueryData(notebookKeys.kernel(id), info),
  });
}

/** Jupyter kernelspecs installed for the server's Python. */
export function useKernelSpecs() {
  return useQuery({
    queryKey: kernelSpecsKey,
    queryFn: () => api<KernelSpecList>("/kernels"),
    staleTime: 60_000,
  });
}

export function useTryRunNotebook() {
  return useMutation({
    mutationFn: ({
      id,
      bindings,
      condaYaml,
      containerImage,
    }: {
      id: string;
      bindings: PortBindingRequest[];
      condaYaml?: string;
      containerImage?: string;
    }) =>
      api<TryRunRecord>(`/notebooks/${id}/try-run`, {
        method: "POST",
        body: JSON.stringify({
          bindings,
          condaYaml,
          containerImage,
        }),
      }),
  });
}

export function useReopenLibraryNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) =>
      api<NotebookDoc>("/script-modules/reopen", {
        method: "POST",
        body: JSON.stringify({ moduleId }),
      }),
    onSuccess: (doc) => refreshNotebooks(qc, doc),
  });
}

export function usePublishNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      name,
      description,
      changelog,
      condaYaml,
      containerImage,
    }: {
      id: string;
      name: string;
      description: string;
      changelog?: string;
      condaYaml?: string;
      containerImage?: string;
    }) =>
      api<ModuleDef>(`/notebooks/${id}/publish`, {
        method: "POST",
        body: JSON.stringify({ name, description, changelog, condaYaml, containerImage }),
      }),
    onSuccess: () => refreshNotebooks(qc),
  });
}

export function useUpdateScriptModuleEnv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; condaYaml: string; containerImage: string }) =>
      api<ScriptModuleView>(`/script-modules/${body.id}`, {
        method: "PUT",
        body: JSON.stringify({ condaYaml: body.condaYaml, containerImage: body.containerImage }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scriptModuleKey });
    },
  });
}
