"use client";

import { useMutation } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { RemoteHost, RemoteProbe } from "./types";

/** Connection test for a saved or edited host. */
export function useTestRemote() {
  return useMutation({
    mutationFn: (host: RemoteHost) => api<RemoteProbe>("/remotes/test", { method: "POST", body: JSON.stringify(host) }),
  });
}
