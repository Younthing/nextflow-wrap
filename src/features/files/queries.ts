"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "@/lib/toast";

import { formatBytes } from "@/features/runs/format";
import { windowProject } from "@/features/workspace/window-project";
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

/** An uploaded file or folder, by its workspace path (`data/reads.fq`). */
export interface IntakePath { path: string; folder: boolean }

/**
 * Uploads dropped, pasted or chosen files (folders included) into the open project's `data/`, and returns their
 * paths on the server. The same everywhere: a browser, or the desktop app with any backend, never reads this
 * computer's paths. As in ComfyUI's upload, a taken name gets a ` (1)` suffix.
 *
 * Call `intake` synchronously inside the drop or paste handler: the browser empties the transfer afterwards.
 */
export function useFileIntake(parent = "data") {
  const qc = useQueryClient();
  return React.useCallback((source: DataTransfer | FileList): Promise<IntakePath[]> => {
    const projectId = windowProject();
    const collected = source instanceof FileList
      ? Promise.resolve(Array.from(source).map((file): UploadItem => ({ name: file.name, kind: "file", files: [{ path: "", file }] })))
      : collectItems(source);
    return (async () => {
      const items = (await collected).filter((item) => item.kind === "directory" || item.files.length);
      if (!items.length) return [];
      // The drop can come before the project list has loaded.
      if (!projectId) { toast.error("先打开项目再上传文件"); return []; }
      const label = items.length === 1 ? items[0]!.name : `${items.length} 项`;
      const progress = toast.progress(`上传 ${label}…`);
      try {
        let shown = 0;
        const uploaded = await uploadItems(projectId, items, ({ loaded, total }) => {
          if (Date.now() - shown < 250) return;
          shown = Date.now();
          progress.update(`上传 ${label} · ${formatBytes(loaded)} / ${formatBytes(total)}`);
        }, undefined, parent);
        progress.success(`已上传：${uploaded.map((item) => item.path).join("、")}`);
        void qc.invalidateQueries({ queryKey: ["fs"] });
        return uploaded.map((item) => ({ path: item.path, folder: item.kind === "directory" }));
      } catch (error) {
        progress.error(error instanceof Error ? error.message : "上传失败");
        return [];
      }
    })();
  }, [qc, parent]);
}

/** URL of a project file by its workspace path, to preview (`download` to save it). */
export function workspaceFileUrl(projectId: string, path: string, kind: "content" | "summary" = "content", download = false): string {
  return `/api/fs/${kind}?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

/** Rename, delete, paste and new-folder actions of the file area. Paths are relative to the project folder. */
export function useWorkspaceEntries(projectId: string) {
  const qc = useQueryClient();
  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["fs"] });
    // A notebook's `.ipynb` may have been renamed, moved or deleted with the files.
    void qc.invalidateQueries({ queryKey: ["notebooks"] });
    void qc.invalidateQueries({ queryKey: ["workflows"] });
    void qc.invalidateQueries({ queryKey: ["documents"] });
  }, [qc]);
  const post = React.useCallback(async <T,>(action: string, body: object): Promise<T> => {
    try {
      const result = await api<T>(`/fs/${action}`, { method: "POST", body: JSON.stringify({ project: projectId, ...body }) });
      const source = body as { path?: string; sources?: string[]; mode?: string };
      const response = result as { path?: string; paths?: string[] };
      const moves = action === "rename" && source.path && response.path ? [{ from: source.path, to: response.path }] : action === "paste" && source.mode === "move" ? (source.sources ?? []).map((from, index) => ({ from, to: response.paths![index] })) : [];
      if (moves.length) window.dispatchEvent(new CustomEvent("studio-files-moved", { detail: moves }));
      const updates = (result as { referenceUpdates?: unknown[] } | undefined)?.referenceUpdates;
      if (updates?.length) window.dispatchEvent(new CustomEvent("studio-reference-updates", { detail: updates }));
      return result;
    } finally {
      refresh();
    }
  }, [projectId, refresh]);
  return React.useMemo(() => ({
    rename: (path: string, name: string) => post<{ path: string }>("rename", { path, name }),
    remove: (paths: string[]) => post<void>("delete", { paths }),
    paste: (sources: string[], target: string, mode: "copy" | "move") => post<{ paths: string[] }>("paste", { sources, target, mode }),
    createFolder: (parent: string, name: string) => post<{ path: string }>("folder", { parent, name }),
    refresh,
  }), [post, refresh]);
}
