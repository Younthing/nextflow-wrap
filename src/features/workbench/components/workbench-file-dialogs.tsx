"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { workspaceFileUrl } from "@/features/files/queries";
import type { FsEntry } from "@/features/files/types";
import { FilePreview, type PreviewSource } from "@/features/runs/components/file-preview";
import { formatBytes } from "@/features/runs/format";
import { previewFor } from "@/features/runs/preview";
import type { Project } from "@/features/workspace/types";

/** Files of an open project, read by their workspace paths. */
export function workspaceSource(projectId: string): PreviewSource {
  return {
    key: ["fs", "content", projectId],
    contentUrl: (path) => workspaceFileUrl(projectId, path),
    summaryUrl: (path) => workspaceFileUrl(projectId, path, "summary"),
  };
}

/** A project file opened with the run results' previewers. */
export function WorkspacePreviewDialog({
  project,
  entry,
  path,
  onClose,
  onDownload,
}: {
  project: Project;
  entry: FsEntry | null;
  path: string;
  onClose: () => void;
  onDownload: (entry: FsEntry) => void;
}) {
  const source = React.useMemo(() => workspaceSource(project.id), [project.id]);
  const size = entry?.size ?? 0;
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[min(80vh,52rem)] w-[min(92vw,64rem)] max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate font-mono text-sm">{path}</DialogTitle>
          <DialogDescription>{formatBytes(size)}{previewFor(path, size) === "html" ? " · 静态预览" : ""}</DialogDescription>
        </DialogHeader>
        {entry ? (
          <div className="flex min-h-0 flex-1 flex-col" aria-label="文件预览">
            <FilePreview key={path} source={source} file={{ path, size, preview: previewFor(path, size) }} fullPath={entry.path} />
          </div>
        ) : null}
        <DialogFooter>
          {entry ? (
            <Button type="button" variant="glass" onClick={() => onDownload(entry)}>
              <Download /> 下载
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for a name: rename a file, folder or notebook, or name a new folder. */
export function NameDialog({
  open,
  title,
  description,
  initial,
  selectStem,
  maxLength,
  pending,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  initial: string;
  /** Select the name without its extension, as file managers do. */
  selectStem?: boolean;
  maxLength: number;
  pending?: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = React.useState(initial);
  const [seeded, setSeeded] = React.useState({ open, initial });
  if (seeded.open !== open || seeded.initial !== initial) {
    setSeeded({ open, initial });
    setName(initial);
  }
  const trimmed = name.trim();
  const problem = !trimmed ? "名称不能为空" : /[\\/]/.test(trimmed) ? "名称不能包含 / 或 \\" : trimmed === "." || trimmed === ".." ? "名称无效" : undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription className="truncate font-mono text-xs">{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (problem || pending) return;
            if (trimmed === initial) { onClose(); return; }
            onSubmit(trimmed);
          }}
        >
          <Input
            aria-label="名称"
            autoFocus
            value={name}
            maxLength={maxLength}
            aria-invalid={problem && name !== initial ? true : undefined}
            onFocus={(event) => {
              const input = event.currentTarget;
              const dot = selectStem ? input.value.lastIndexOf(".") : -1;
              input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
            }}
            onChange={(event) => setName(event.target.value)}
          />
          {problem && name !== initial ? <p role="alert" className="-mt-1 text-xs text-destructive">{problem}</p> : null}
          <DialogFooter>
            <Button type="button" variant="glass" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={Boolean(problem) || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="break-all">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="glass" onClick={onClose}>取消</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
