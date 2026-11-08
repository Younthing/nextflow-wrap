"use client";

import { windowProject } from "@/features/workspace/window-project";

import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { EditorStore } from "@/features/editor/store";
import { getEditorSaveSession } from "@/features/editor/editor-save";
import { api, ApiError } from "@/lib/api";
import { scriptModuleKey, type ScriptModuleList } from "@/features/notebook/queries";
import { indexModules, type ModuleIndex } from "./catalog";
import { duplicateWorkflowName, WORKFLOW_NAME_MAX } from "./library";
import type { ModuleDef, WorkflowDoc, WorkflowSummary } from "./types";

export const workflowKeys = {
  all: ["workflows"] as const,
  detail: (id: string, project = windowProject()) => ["workflows", project, id] as const,
};

export interface ModuleCatalog {
  /** Published modules. Builtins are added by `indexModules`. */
  modules: ModuleDef[];
  index: ReturnType<typeof indexModules>;
}

// Defined once so React Query can memoise the derived index by data identity.
const withIndex = (list: ScriptModuleList): ModuleCatalog => ({
  modules: list.modules,
  index: indexModules(list.modules),
});

/** The published modules a canvas can use. Shares its cache with the notebook library, so a publish refreshes it. */
export const moduleCatalogQueryOptions = () =>
  queryOptions({
    queryKey: [...scriptModuleKey, windowProject()],
    queryFn: () => api<ScriptModuleList>("/script-modules"),
  });

/**
 * The module index for a one-off plan. Reuses the editor's index once the
 * published modules are cached; before that it only knows the builtins.
 */
export async function loadModuleIndex(
  qc: QueryClient,
  stored: ModuleIndex,
): Promise<{ index: ModuleIndex; error?: string }> {
  const options = moduleCatalogQueryOptions();
  const cached = qc.getQueryData(options.queryKey);
  if (stored.size && cached) return { index: stored };
  try {
    const raw = cached ?? (await qc.fetchQuery(options));
    return { index: indexModules(raw.modules) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { index: new Map(), error: `模块库加载失败：${message}` };
  }
}

export function useModuleCatalog() {
  return useQuery({ ...moduleCatalogQueryOptions(), select: withIndex });
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
    queryKey: [...workflowKeys.all, windowProject()],
    queryFn: () => api<WorkflowSummary[]>("/workflows"),
  });
}

export const fetchWorkflow = (id: string, project = windowProject()) =>
  api<WorkflowDoc>(`/workflows/${id}`, { headers: { "x-project-id": project ?? "" } });

export function useWorkflow(id: string | undefined) {
  const project = windowProject();
  return useQuery({
    queryKey: workflowKeys.detail(id ?? ""),
    // A missing workflow resolves to null so the editor can fall back to a new one.
    queryFn: () =>
      fetchWorkflow(id!, project).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    enabled: !!id,
  });
}

export function useSaveWorkflow(store?: EditorStore) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: WorkflowDoc) =>
      doc.id
        ? api<WorkflowDoc>(`/workflows/${doc.id}`, {
            method: "PUT",
            body: JSON.stringify(doc),
          })
        : api<WorkflowDoc>("/workflows", {
            method: "POST",
            body: JSON.stringify(doc),
          }),
    onSuccess: async (doc) => {
      // Note the revision before the cache update so the open editor can tell
      // this echo from a library rename before its updatedAt effect runs.
      if (store) {
        getEditorSaveSession(store).noteEditorRevision(doc.id, doc.updatedAt);
        store.setState({ fileVersion: doc.fileVersion, filePath: doc.filePath, projectId: doc.projectId });
      }
      await qc.cancelQueries({ queryKey: workflowKeys.detail(doc.id, doc.projectId) });
      qc.setQueryData(workflowKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: workflowKeys.all });
    },
    onError: (err, doc) => {
      if (!(err instanceof ApiError) || err.status !== 409 || !doc.id) return;
      store?.setState({ conflict: err.message });
      void qc.invalidateQueries({ queryKey: workflowKeys.detail(doc.id) });
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/workflows/${id}`, { method: "DELETE" }),
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
        body: JSON.stringify({
          ...doc,
          id: "",
          name: duplicateWorkflowName(doc.name),
        }),
      });
    },
    onSuccess: (doc) => {
      qc.setQueryData(workflowKeys.detail(doc.id), doc);
      void qc.invalidateQueries({ queryKey: workflowKeys.all, exact: true });
    },
  });
}
