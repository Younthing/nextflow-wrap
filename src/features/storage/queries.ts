"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CleanupResult, StorageReport } from "./types";

export const storageKeys = { report: ["storage"] as const };

export function useStorageReport(enabled = true) {
  return useQuery({ queryKey: storageKeys.report, queryFn: () => api<StorageReport>("/storage"), enabled, staleTime: 30_000 });
}

export function useCleanSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, results }: { key: string; results: boolean }) =>
      api<CleanupResult>(`/storage/sessions/${encodeURIComponent(key)}/clean`, { method: "POST", body: JSON.stringify({ results }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storageKeys.report });
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
