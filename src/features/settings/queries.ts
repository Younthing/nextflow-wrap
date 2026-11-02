"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { rememberLaunchDefaults } from "@/features/runs/saved-launch";
import { api } from "@/lib/api";
import type { SettingsUpdate, SettingsView } from "./types";

export const settingsKeys = { view: ["settings"] as const };

export function useSettings() {
  return useQuery({ queryKey: settingsKeys.view, queryFn: () => api<SettingsView>("/settings") });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (update: SettingsUpdate) => api<SettingsView>("/settings", { method: "PUT", body: JSON.stringify(update) }),
    onSuccess: (view) => {
      qc.setQueryData(settingsKeys.view, view);
      const { defaultEngine, cpus, memory } = view.settings.runtime;
      rememberLaunchDefaults({ engine: defaultEngine, cpus, memory });
      void qc.invalidateQueries({ queryKey: ["assistant", "status"] });
    },
  });
}
