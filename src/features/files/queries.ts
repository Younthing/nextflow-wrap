"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "@/lib/toast";

import { formatBytes } from "@/features/runs/format";
import { projectsQuery } from "@/features/workspace/queries";
import { api } from "@/lib/api";
import { nativeFiles } from "@/lib/desktop";
import type { FsListing } from "./types";
import { collectItems, uploadItems } from "./upload";

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
 * Turns dropped or pasted files into server paths. With native paths (desktop app, server on this computer or in
 * WSL) the files are used where they are; otherwise they are uploaded into the open project's `data/`.
 *
 * Call `intake` synchronously inside the drop or paste handler: the browser empties the transfer afterwards.
 */
export function useFileIntake() {
  const qc = useQueryClient();
  return React.useCallback((transfer: DataTransfer, options: { upload?: boolean } = {}): Promise<IntakePath[]> => {
    const bridge = nativeFiles();
    if (bridge) {
      const native = Array.from(transfer.items).filter((item) => item.kind === "file").flatMap((item) => {
        const file = item.getAsFile();
        const path = file ? bridge.pathForFile(file) : undefined;
        return path ? [{ path, folder: item.webkitGetAsEntry?.()?.isDirectory === true }] : [];
      });
      if (native.length) return Promise.resolve(native);
    }
    // Settings and other configuration need a path that already exists on the server, not a copy in data/.
    if (options.upload === false) {
      if (transfer.files.length) toast.warning("这里需要服务端上的路径，请点浏览选择");
      return Promise.resolve([]);
    }
    const collected = collectItems(transfer);
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
        return uploaded.map((item) => ({ path: item.path, folder: item.kind === "directory" }));
      } catch (error) {
        progress.error(error instanceof Error ? error.message : "上传失败");
        return [];
      }
    })();
  }, [qc]);
}
