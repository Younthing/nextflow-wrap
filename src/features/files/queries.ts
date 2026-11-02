"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "@/lib/toast";

import { formatBytes } from "@/features/runs/format";
import { projectsQuery } from "@/features/workspace/queries";
import { api } from "@/lib/api";
import type { FsListing } from "./types";
import { collectItems, uploadItems, type UploadItem } from "./upload";

export function useFsListing(path: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["fs", path ?? ""],
    queryFn: () => api<FsListing>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),
    enabled,
    staleTime: 5_000,
  });
}

/** A file or folder the page can hand to the server, by its path there. */
export interface IntakePath { path: string; folder: boolean }

/**
 * Uploads dropped, pasted or chosen files (folders included) into the open project's `data/`, and returns their
 * paths on the server. The same everywhere: a browser, or the desktop app with any backend, never reads this
 * computer's paths. As in ComfyUI's upload, a taken name gets a ` (1)` suffix.
 *
 * Call `intake` synchronously inside the drop or paste handler: the browser empties the transfer afterwards.
 */
export function useFileIntake() {
  const qc = useQueryClient();
  return React.useCallback((source: DataTransfer | FileList): Promise<IntakePath[]> => {
    const collected = source instanceof FileList
      ? Promise.resolve(Array.from(source).map((file): UploadItem => ({ name: file.name, kind: "file", files: [{ path: "", file }] })))
      : collectItems(source);
    return (async () => {
      const items = (await collected).filter((item) => item.kind === "directory" || item.files.length);
      if (!items.length) return [];
      // The drop can come before the project list has loaded.
      const projectId = (await qc.ensureQueryData(projectsQuery).catch(() => undefined))?.current;
      if (!projectId) { toast.error("先打开项目再上传文件"); return []; }
      const label = items.length === 1 ? items[0]!.name : `${items.length} 项`;
      const progress = toast.progress(`上传 ${label}…`);
      try {
        let shown = 0;
        const uploaded = await uploadItems(projectId, items, ({ loaded, total }) => {
          if (Date.now() - shown < 250) return;
          shown = Date.now();
          progress.update(`上传 ${label} · ${formatBytes(loaded)} / ${formatBytes(total)}`);
        });
        progress.success(`已上传到 data/：${uploaded.map((item) => item.path.slice(item.path.lastIndexOf("/") + 1)).join("、")}`);
        void qc.invalidateQueries({ queryKey: ["fs"] });
        return uploaded.map((item) => ({ path: item.path, folder: item.kind === "directory" }));
      } catch (error) {
        progress.error(error instanceof Error ? error.message : "上传失败");
        return [];
      }
    })();
  }, [qc]);
}
