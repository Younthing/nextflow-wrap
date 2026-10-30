"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ResultFile } from "./outputs";
import type { LaunchRequest, RunDetail, RunStatus, RunSummary, TaskRecord } from "./types";

export const runKeys = {
  all: ["runs"] as const,
  list: (workflowId?: string) => ["runs", "list", workflowId ?? ""] as const,
  detail: (id: string) => ["runs", "detail", id] as const,
};

export const isActive = (status: RunStatus) => status === "submitted" || status === "running";

const POLL_MS = 2_000;

export function useRuns(workflowId?: string) {
  return useQuery({
    queryKey: runKeys.list(workflowId),
    queryFn: () => api<RunSummary[]>(workflowId ? `/runs?workflowId=${encodeURIComponent(workflowId)}` : "/runs"),
    // Keep polling while anything is still running.
    refetchInterval: (q) => (q.state.data?.some((r) => isActive(r.status)) ? POLL_MS : false),
  });
}

export function useRun(id: string) {
  return useQuery({
    queryKey: runKeys.detail(id),
    queryFn: () => api<RunDetail>(`/runs/${id}`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? POLL_MS / 2 : false),
  });
}

export function useLaunchRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: LaunchRequest) => api<RunDetail>("/runs", { method: "POST", body: JSON.stringify(req) }),
    onSuccess: (run) => {
      qc.setQueryData(runKeys.detail(run.id), run);
      void qc.invalidateQueries({ queryKey: ["runs", "list"] });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<RunDetail>(`/runs/${id}/cancel`, { method: "POST" }),
    onSuccess: (run) => {
      qc.setQueryData(runKeys.detail(run.id), run);
      void qc.invalidateQueries({ queryKey: ["runs", "list"] });
    },
  });
}

export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/runs/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: runKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ["runs", "list"] });
    },
  });
}

// Detail data for a run. Each polls while the run is still active.
const pollWhile = (active: boolean) => (active ? POLL_MS : false);

export function useRunTasks(id: string, active: boolean) {
  return useQuery({
    queryKey: [...runKeys.detail(id), "tasks"],
    queryFn: () => api<TaskRecord[]>(`/runs/${id}/tasks`),
    refetchInterval: pollWhile(active),
  });
}

export function useRunLog(id: string, active: boolean) {
  return useQuery({
    queryKey: [...runKeys.detail(id), "log"],
    queryFn: () => api<{ lines: string[] }>(`/runs/${id}/log`),
    refetchInterval: pollWhile(active),
  });
}

export function useTaskLog(id: string, hash: string | null, active: boolean) {
  return useQuery({
    queryKey: [...runKeys.detail(id), "task-log", hash],
    queryFn: () => api<{ text: string }>(`/runs/${id}/task-log?hash=${encodeURIComponent(hash ?? "")}`),
    enabled: !!hash,
    refetchInterval: pollWhile(active),
  });
}

export function useRunResults(id: string, active: boolean) {
  return useQuery({
    queryKey: [...runKeys.detail(id), "results"],
    queryFn: () => api<ResultFile[]>(`/runs/${id}/results`),
    refetchInterval: pollWhile(active),
  });
}

export function useResultContent(id: string, path: string | null) {
  return useQuery({
    queryKey: [...runKeys.detail(id), "content", path],
    queryFn: async () => {
      const res = await fetch(`/api/runs/${id}/results/content?path=${encodeURIComponent(path ?? "")}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
      return { contentType: res.headers.get("content-type") ?? "text/plain", body: await res.text() };
    },
    enabled: !!path,
    staleTime: Infinity,
  });
}
