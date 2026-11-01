"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { FsListing } from "./types";

export function useFsListing(path: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["fs", path ?? ""],
    queryFn: () => api<FsListing>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),
    enabled,
    staleTime: 5_000,
  });
}
