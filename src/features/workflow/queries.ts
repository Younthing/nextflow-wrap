"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { noteEditorRevision } from "@/features/editor/editor-save";
import { api, ApiError } from "@/lib/api";
import { indexModules } from "./catalog";
import { duplicateWorkflowName, WORKFLOW_NAME_MAX } from "./library";
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
    onSuccess: async (doc) => {
      // Note the revision before the cache update so the open editor can tell
      // this echo from a library rename before its updatedAt effect runs.
      noteEditorRevision(doc.id, doc.updatedAt);
      await qc.cancelQueries({ queryKey: workflowKeys.detail(doc.id) });
      qc.setQueryData(workflowKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
    onError: (err, doc) => {
      if (!(err instanceof ApiError) || err.status !== 409 || !doc.id) return;
      void qc.invalidateQueries({ queryKey: workflowKeys.detail(doc.id) });
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

/** Renames with GET + PUT. The workflows API has no rename route. */
export function useRenameWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const next = name.trim();
      if (!next || next.length > WORKFLOW_NAME_MAX) {
        throw new Error(`名称需要 1–${WORKFLOW_NAME_MAX} 个字符`);
      }
      const doc = await api<WorkflowDoc>(`/workflows/${id}`);
      return api<WorkflowDoc>(`/workflows/${id}`, {
        method: "PUT",
        body: JSON.stringify({ ...doc, name: next }),
      });
    },
    onSuccess: (doc) => {
      qc.setQueryData(workflowKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
    onError: (_err, { id }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}

/** Copies with GET + POST. The workflows API has no duplicate route. */
export function useDuplicateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const doc = await api<WorkflowDoc>(`/workflows/${id}`);
      return api<WorkflowDoc>("/workflows", {
        method: "POST",
        body: JSON.stringify({ ...doc, id: "", name: duplicateWorkflowName(doc.name) }),
      });
    },
    onSuccess: (doc) => {
      qc.setQueryData(workflowKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}
