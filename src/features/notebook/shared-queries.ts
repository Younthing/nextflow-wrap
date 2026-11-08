"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { windowProject } from "@/features/workspace/window-project";
import type { ModuleDef } from "@/features/workflow/types";

export function useSharedModules() {
  return useQuery({ queryKey: ["shared-modules"], queryFn: () => api<ModuleDef[]>("/script-modules/shared"), enabled: !!windowProject() });
}

export function useTransferModule(action: "share" | "install") {
  const qc = useQueryClient();
  const projectId = windowProject();
  return useMutation({
    mutationFn: (moduleId: string) => api<ModuleDef>(`/script-modules/${action}`, { method: "POST", body: JSON.stringify({ moduleId, projectId }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["shared-modules"] }); void qc.invalidateQueries({ queryKey: ["script-modules"] }); },
  });
}
