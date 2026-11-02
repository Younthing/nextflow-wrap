"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, File, Folder, Loader2, NotebookText, Plus, RefreshCw, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useFileIntake, useFsListing } from "@/features/files/queries";
import type { FsEntry } from "@/features/files/types";
import type { NotebookSummary } from "@/features/notebook/types";
import { formatBytes } from "@/features/runs/format";
import type { Project } from "@/features/workspace/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const rowClass = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] text-foreground/90 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

/** Path relative to the project folder, the form a notebook cell reads it with. */
export function relativeToProject(project: Pick<Project, "path">, path: string): string {
  return path.startsWith(`${project.path}/`) ? path.slice(project.path.length + 1) : path;
}

/** Copy the absolute path: notebook kernels run in their own scratch folder, so a relative path would not resolve. */
function copyPath(project: Project, entry: FsEntry) {
  void navigator.clipboard?.writeText(entry.path).then(
    () => toast.success(`已复制 ${relativeToProject(project, entry.path)} 的完整路径`),
    () => toast.warning(`无法写入剪贴板：${entry.path}`),
  );
}

function Directory({ project, entry, depth }: { project: Project; entry: FsEntry; depth: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li>
      <button type="button" aria-expanded={open} className={rowClass} style={{ paddingLeft: `${6 + depth * 14}px` }} onClick={() => setOpen(!open)}>
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <Folder className="size-3.5 shrink-0 text-port-meta" aria-hidden />
        <span className="truncate">{entry.name}</span>
      </button>
      {open ? <Listing project={project} path={entry.path} depth={depth + 1} /> : null}
    </li>
  );
}

function Listing({ project, path, depth }: { project: Project; path: string; depth: number }) {
  const listing = useFsListing(path, true);
  if (listing.isPending) return <p className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground" style={{ paddingLeft: `${20 + depth * 14}px` }}><Loader2 className="size-3 animate-spin" />读取中…</p>;
  if (listing.error) return <p className="py-1 text-xs text-destructive" style={{ paddingLeft: `${20 + depth * 14}px` }}>{listing.error.message}</p>;
  // A listing for another folder means this one is gone (the API falls back to its parent).
  const entries = listing.data.path === path ? listing.data.entries : [];
  if (!entries.length) return <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${26 + depth * 14}px` }}>空文件夹</p>;
  return (
    <ul aria-label={depth === 0 ? "项目文件" : undefined}>
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <Directory key={entry.path} project={project} entry={entry} depth={depth} />
        ) : (
          <li key={entry.path}>
            <button
              type="button"
              className={rowClass}
              style={{ paddingLeft: `${26 + depth * 14}px` }}
              title={`${relativeToProject(project, entry.path)} · ${formatBytes(entry.size)}\n单击复制完整路径`}
              onClick={() => copyPath(project, entry)}
            >
              <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/** Left column, top: the project's notebooks, then its folder on disk. */
export function WorkbenchFiles({
  project,
  notebooks,
  loading,
  activeId,
  creating,
  onCreate,
}: {
  project: Project;
  notebooks: NotebookSummary[];
  loading?: boolean;
  activeId?: string;
  creating?: boolean;
  onCreate: () => void;
}) {
  const qc = useQueryClient();
  const intake = useFileIntake();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 pb-1">
        <h2 className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">笔记本</h2>
        <Button type="button" size="icon-sm" variant="ghost" className="ml-auto size-6" aria-label="新建笔记本" disabled={creating} onClick={onCreate}>
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
        </Button>
      </div>
      <ul aria-label="项目里的笔记本" className="grid gap-px px-1">
        {loading ? <li className="px-2 py-1 text-xs text-muted-foreground">读取中…</li> : null}
        {!loading && notebooks.length === 0 ? <li className="px-2 py-1 text-xs text-muted-foreground">暂无笔记本</li> : null}
        {notebooks.map((nb) => (
          <li key={nb.id}>
            <Link
              href={`/workbench/${nb.id}`}
              aria-current={nb.id === activeId ? "page" : undefined}
              className={cn(rowClass, "gap-2 px-2", nb.id === activeId && "bg-primary/12 font-medium text-primary hover:bg-primary/15")}
            >
              <NotebookText className="size-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{nb.name}</span>
              {nb.publishState === "published" ? (
                <span className="ml-auto shrink-0 rounded-full bg-success/15 px-1.5 text-[10px] font-medium text-success" title={`已导出为模块 ${nb.publishedVersion ?? ""}`}>{nb.publishedVersion ?? "模块"}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-1 px-2 pb-1">
        <h2 className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">文件</h2>
        <Button type="button" size="icon-sm" variant="ghost" className="ml-auto size-6" aria-label="上传到 data/" title="上传到 data/" onClick={() => fileInput.current?.click()}>
          <Upload />
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="选择要上传的文件"
          onChange={(event) => {
            if (event.target.files?.length) void intake(event.target.files);
            event.target.value = "";
          }}
        />
        <Button type="button" size="icon-sm" variant="ghost" className="size-6" aria-label="刷新文件" onClick={() => void qc.invalidateQueries({ queryKey: ["fs"] })}>
          <RefreshCw />
        </Button>
      </div>
      {/* The workspace is where notebooks and workflows read files: drop files or folders here to upload them. */}
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto rounded-md px-1 pb-2", dragging && "ring-2 ring-primary/60")}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false);
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          void intake(event.dataTransfer);
        }}
      >
        <Listing project={project} path={project.path} depth={0} />
      </div>
    </div>
  );
}
