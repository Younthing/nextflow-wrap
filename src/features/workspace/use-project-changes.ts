"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mockingActive } from "@/lib/mocking";

export function useProjectChanges(project?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!project) return;
    const refresh = () => {
      for (const key of ["fs", "notebooks", "workflows", "documents", "script-modules", "runs"]) void qc.invalidateQueries({ queryKey: [key] });
    };
    const stream = mockingActive() ? undefined : new EventSource(`/api/documents/changes?project=${encodeURIComponent(project)}`);
    if (stream) stream.onmessage = (event) => {
      const change = JSON.parse(event.data);
      if (change.refresh || change.paths?.length) refresh();
    };
    window.addEventListener("focus", refresh);
    return () => { stream?.close(); window.removeEventListener("focus", refresh); };
  }, [project, qc]);
}
