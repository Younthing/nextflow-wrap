"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { SetupStatus, ToolId } from "./types";

export const setupKeys = { status: ["setup", "status"] as const };

/** Tool checks spawn a few commands, so they refresh slowly unless an install is running. */
export function useSetupStatus() {
  return useQuery({
    queryKey: setupKeys.status,
    queryFn: () => api<SetupStatus>("/setup"),
    refetchInterval: (query) => (query.state.data?.tools.some((tool) => tool.state === "installing") ? 2_000 : false),
    staleTime: 10_000,
  });
}

export function useInstallTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tool: ToolId) => api<{ started: boolean; message?: string }>("/setup/install", { method: "POST", body: JSON.stringify({ tool }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: setupKeys.status }),
  });
}
