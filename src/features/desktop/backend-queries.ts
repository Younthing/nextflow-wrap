"use client";

import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";

import { desktop } from "@/lib/desktop";

/**
 * The desktop shell's backend, read through `window.studioDesktop.backend` (not the server's API: the shell
 * starts and stops the server). Undefined in a browser and in shells older than backend management.
 */
export const backendBridge = () => desktop()?.backend;

export function useBackendInfo() {
  return useQuery({
    queryKey: ["desktop", "backend", "info"],
    queryFn: async () => (await backendBridge()?.info()) ?? null,
    enabled: typeof window !== "undefined" && Boolean(backendBridge()),
    staleTime: Infinity,
  });
}

export function useBackendList(enabled: boolean) {
  return useQuery({
    queryKey: ["desktop", "backend", "list"],
    queryFn: async () => (await backendBridge()?.list()) ?? null,
    enabled: enabled && Boolean(backendBridge()),
  });
}

export function useWslDistros(enabled: boolean) {
  return useQuery({
    queryKey: ["desktop", "backend", "distros"],
    queryFn: async () => (await backendBridge()?.distros()) ?? [],
    enabled: enabled && Boolean(backendBridge()),
  });
}

/** Whether the backend manager dialog is open; the File menu's "后端环境…" opens it from any page. */
export const useBackendManager = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
