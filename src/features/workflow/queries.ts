"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { indexModules } from "./catalog";
import type { ModuleCatalog, WorkflowDoc, WorkflowSummary } from "./types";

export const workflowKeys = {
  all: ["workflows"] as const,
  detail: (id: string) => ["workflows", id] as const,
};

// Defined once so React Query can memoise the derived index by data identity.
const withIndex = (catalog: ModuleCatalog) => ({ ...catalog, index: indexModules(catalog.modules) });

export function useModuleCatalog() {
  return useQuery({
    queryKey: ["modules"],
    queryFn: () => api<ModuleCatalog>("/modules"),
    staleTime: Infinity,
    select: withIndex,
  });
}

export interface JsonSchema {
  title?: string;
  description?: string;
  type?: string | string[];
  format?: string;
  enum?: (string | number)[];
  default?: unknown;
  hidden?: boolean;
  required?: string[];
  pattern?: string;
  exists?: boolean;
  schema?: string;
  mimetype?: string;
  fa_icon?: string;
  help_text?: string;
  properties?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  allOf?: { $ref: string }[];
}

export function useWorkflows() {
  return useQuery({
    queryKey: workflowKeys.all,
    queryFn: () => api<WorkflowSummary[]>("/workflows"),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.detail(id ?? ""),
    // A missing workflow resolves to null so the editor can fall back to a new one.
    queryFn: () =>
      api<WorkflowDoc>(`/workflows/${id}`).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    enabled: !!id,
  });
}

export function useSaveWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: WorkflowDoc) =>
      doc.id
        ? api<WorkflowDoc>(`/workflows/${doc.id}`, { method: "PUT", body: JSON.stringify(doc) })
        : api<WorkflowDoc>("/workflows", { method: "POST", body: JSON.stringify(doc) }),
    onSuccess: (doc) => {
      qc.setQueryData(workflowKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/workflows/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: workflowKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}
