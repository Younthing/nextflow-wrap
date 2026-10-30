"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { LaunchRequest, RunDetail, RunStatus, RunSummary } from "./types";

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
