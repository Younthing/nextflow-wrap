"use client";

import { useMutation } from "@tanstack/react-query";

/** Downloads the redacted diagnostics bundle (`?run=` adds that run's logs and configs) and saves it. */
async function downloadDiagnostics(runId?: string): Promise<string> {
  const response = await fetch(`/api/diagnostics${runId ? `?run=${encodeURIComponent(runId)}` : ""}`);
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? response.statusText);
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "nextflow-studio-diagnostics.tar.gz";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

export function useDownloadDiagnostics() {
  return useMutation({ mutationFn: (runId?: string) => downloadDiagnostics(runId) });
}
