"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  File,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  NotebookText,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useFileIntake, useFsListing, useWorkspaceEntries, workspaceFileUrl } from "@/features/files/queries";
import type { FsEntry } from "@/features/files/types";
import { serializeIpynb } from "@/features/notebook/ipynb";
import { notebookKeys, useDeleteNotebook, useDuplicateNotebook, useRenameNotebook } from "@/features/notebook/queries";
import type { NotebookDoc, NotebookSummary } from "@/features/notebook/types";
import { formatBytes } from "@/features/runs/format";
import type { Project } from "@/features/workspace/types";
import { api } from "@/lib/api";
import { mockingActive } from "@/lib/mocking";
import { saveTextFile, saveUrl } from "@/lib/save-file";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { setClip, useClip } from "../clipboard";
import { ConfirmDeleteDialog, NameDialog, WorkspacePreviewDialog } from "./workbench-file-dialogs";

const rowClass = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] text-foreground/90 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none data-[state=open]:bg-accent";

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Path relative to the project folder, the form a notebook cell reads it with. */
export function relativeToProject(project: Pick<Project, "path">, path: string): string {
  if (path === project.path) return "";
  return path.startsWith(`${project.path}/`) ? path.slice(project.path.length + 1) : path;
}

/** The folder a workspace path is in; `""` is the project folder. */
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`已复制 ${text}`),
    () => toast.warning(`无法写入剪贴板：${text}`),
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : "操作失败");

type Dialog =
  | { kind: "preview"; entry: FsEntry }
  | { kind: "rename-file"; entry: FsEntry }
  | { kind: "delete-file"; entry: FsEntry }
  | { kind: "new-folder"; parent: string }
  | { kind: "rename-notebook"; notebook: NotebookSummary }
  | { kind: "delete-notebook"; notebook: NotebookSummary };

interface FileActions {
  project: Project;
  open: (dialog: Dialog) => void;
  /** Paste the clipped files into a folder (workspace path). */
  paste: (folder: string) => void;
  clip: (entry: FsEntry, mode: "copy" | "move") => void;
  download: (entry: FsEntry) => void;
  canPaste: boolean;
}

const FileActionsContext = React.createContext<FileActions | null>(null);
const useFileActions = () => React.useContext(FileActionsContext)!;

/** The right-click menu of a file or folder, and the keyboard shortcuts its row answers to. */
function EntryMenu({ entry, children }: { entry: FsEntry; children: React.ReactElement }) {
  const actions = useFileActions();
  const path = relativeToProject(actions.project, entry.path);
  const folder = entry.kind === "directory";
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44" aria-label={`${entry.name} 的操作`}>
        {folder ? null : (
          <ContextMenuItem onSelect={() => actions.open({ kind: "preview", entry })}>
            <Eye /> 预览
          </ContextMenuItem>
        )}
        {folder ? null : (
          <ContextMenuItem onSelect={() => actions.download(entry)}>
            <Download /> 下载
          </ContextMenuItem>
        )}
        {folder ? null : <ContextMenuSeparator />}
        <ContextMenuItem onSelect={() => actions.clip(entry, "copy")}>
          <Copy /> 复制 <ContextMenuShortcut>{mod}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.clip(entry, "move")}>
          <Scissors /> 剪切 <ContextMenuShortcut>{mod}X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!actions.canPaste} onSelect={() => actions.paste(folder ? path : parentOf(path))}>
          <ClipboardPaste /> {folder ? "粘贴到此文件夹" : "粘贴"} <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(path)}>
          <Link2 /> 复制路径
        </ContextMenuItem>
        <ContextMenuSeparator />
        {folder ? (
          <ContextMenuItem onSelect={() => actions.open({ kind: "new-folder", parent: path })}>
            <FolderPlus /> 新建文件夹
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => actions.open({ kind: "rename-file", entry })}>
          <Pencil /> 重命名 <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => actions.open({ kind: "delete-file", entry })}>
          <Trash2 /> 删除 <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** F2, Delete and copy, cut, paste on a focused row, as in a desktop file manager. */
function entryKeys(actions: FileActions, entry: FsEntry) {
  return (event: React.KeyboardEvent) => {
    const path = relativeToProject(actions.project, entry.path);
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (event.key === "F2") actions.open({ kind: "rename-file", entry });
    else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) actions.open({ kind: "delete-file", entry });
    else if (command && key === "c") actions.clip(entry, "copy");
    else if (command && key === "x") actions.clip(entry, "move");
    else if (command && key === "v") actions.paste(entry.kind === "directory" ? path : parentOf(path));
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}

function Directory({ entry, depth }: { entry: FsEntry; depth: number }) {
  const actions = useFileActions();
  const [open, setOpen] = React.useState(false);
  return (
    <li>
      <EntryMenu entry={entry}>
        <button
          type="button"
          aria-expanded={open}
          className={rowClass}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => setOpen(!open)}
          onKeyDown={entryKeys(actions, entry)}
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
          <Folder className="size-3.5 shrink-0 text-port-meta" aria-hidden />
          <span className="truncate">{entry.name}</span>
        </button>
      </EntryMenu>
      {open ? <Listing path={entry.path} depth={depth + 1} /> : null}
    </li>
  );
}

function FileRow({ entry, depth }: { entry: FsEntry; depth: number }) {
  const actions = useFileActions();
  return (
    <li>
      <EntryMenu entry={entry}>
        <button
          type="button"
          className={rowClass}
          style={{ paddingLeft: `${26 + depth * 14}px` }}
          title={`${relativeToProject(actions.project, entry.path)} · ${formatBytes(entry.size)}\n单击预览，右键查看更多操作`}
          onClick={() => actions.open({ kind: "preview", entry })}
          onKeyDown={entryKeys(actions, entry)}
        >
          <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{entry.name}</span>
        </button>
      </EntryMenu>
    </li>
  );
}

function Listing({ path, depth }: { path: string; depth: number }) {
  const listing = useFsListing(path, true);
  if (listing.isPending) return <p className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground" style={{ paddingLeft: `${20 + depth * 14}px` }}><Loader2 className="size-3 animate-spin" />读取中…</p>;
  if (listing.error) return <p className="py-1 text-xs text-destructive" style={{ paddingLeft: `${20 + depth * 14}px` }}>{listing.error.message}</p>;
  // A listing for another folder means this one is gone (the API falls back to its parent).
  const entries = listing.data.path === path ? listing.data.entries : [];
  if (!entries.length) return <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${26 + depth * 14}px` }}>空文件夹</p>;
  return (
    <ul aria-label={depth === 0 ? "项目文件" : undefined}>
      {entries.map((entry) =>
        entry.kind === "directory" ? <Directory key={entry.path} entry={entry} depth={depth} /> : <FileRow key={entry.path} entry={entry} depth={depth} />,
      )}
    </ul>
  );
}

/** The right-click menu of a notebook in the list. */
function NotebookMenu({
  notebook,
  children,
  onOpen,
  onDialog,
  onPaste,
  canPaste,
  onDownload,
}: {
  notebook: NotebookSummary;
  children: React.ReactElement;
  onOpen: () => void;
  onDialog: (dialog: Dialog) => void;
  onPaste: () => void;
  canPaste: boolean;
  onDownload: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44" aria-label={`${notebook.name} 的操作`}>
        <ContextMenuItem onSelect={onOpen}>
          <NotebookText /> 打开
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDownload}>
          <Download /> 下载 .ipynb
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            setClip({ kind: "notebook", id: notebook.id, name: notebook.name });
            toast.success(`已复制笔记本「${notebook.name}」，可粘贴到任一项目`);
          }}
        >
          <Copy /> 复制 <ContextMenuShortcut>{mod}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!canPaste} onSelect={onPaste}>
          <ClipboardPaste /> 粘贴 <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onDialog({ kind: "rename-notebook", notebook })}>
          <Pencil /> 重命名 <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => onDialog({ kind: "delete-notebook", notebook })}>
          <Trash2 /> 删除 <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Left column, top: the project's notebooks, then its folder on disk. Both answer to right-click. */
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
  const router = useRouter();
  const qc = useQueryClient();
  const intake = useFileIntake();
  const entries = useWorkspaceEntries(project.id);
  const deleteNotebook = useDeleteNotebook();
  const renameNotebook = useRenameNotebook();
  const duplicateNotebook = useDuplicateNotebook();
  const clip = useClip();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [busy, setBusy] = React.useState(false);

  const canPasteFiles = clip?.kind === "files" && clip.projectId === project.id;
  const canPasteNotebook = clip?.kind === "notebook";

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast.success(done);
      setDialog(null);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const actions: FileActions = {
    project,
    open: setDialog,
    canPaste: canPasteFiles,
    clip: (entry, mode) => {
      const path = relativeToProject(project, entry.path);
      setClip({ kind: "files", projectId: project.id, paths: [path], mode });
      toast.success(mode === "copy" ? `已复制 ${path}，右键文件夹粘贴` : `已剪切 ${path}，右键文件夹粘贴`);
    },
    paste: (folder) => {
      if (clip?.kind !== "files" || clip.projectId !== project.id) return;
      const { paths, mode } = clip;
      void run(async () => {
        const result = await entries.paste(paths, folder, mode);
        // A cut is pasted once; a copy can be pasted again.
        if (mode === "move") setClip(null);
        toast.success(`已${mode === "copy" ? "粘贴" : "移动"}到 ${folder || "项目文件夹"}：${result.paths.join("、")}`);
      });
    },
    download: (entry) => {
      const path = relativeToProject(project, entry.path);
      void saveUrl(workspaceFileUrl(project.id, path, "content", true), entry.name, mockingActive()).catch((error) => toast.error(`下载失败：${errorText(error)}`));
    },
  };

  const downloadNotebook = (notebook: NotebookSummary) => {
    void qc
      .fetchQuery({ queryKey: notebookKeys.detail(notebook.id), queryFn: () => api<NotebookDoc>(`/notebooks/${notebook.id}`), staleTime: 0 })
      .then((doc) => saveTextFile(`${doc.name}.ipynb`, "application/x-ipynb+json", serializeIpynb(doc)))
      .catch((error) => toast.error(`下载失败：${errorText(error)}`));
  };

  const pasteNotebook = () => {
    if (clip?.kind !== "notebook") return;
    duplicateNotebook.mutate(
      { id: clip.id, projectId: project.id },
      {
        onSuccess: (doc) => {
          toast.success(`已粘贴为「${doc.name}」`);
          router.push(`/workbench/${doc.id}`);
        },
        onError: (error) => toast.error(errorText(error)),
      },
    );
  };

  const notebookKeysFor = (notebook: NotebookSummary) => (event: React.KeyboardEvent) => {
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (event.key === "F2") setDialog({ kind: "rename-notebook", notebook });
    else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) setDialog({ kind: "delete-notebook", notebook });
    else if (command && key === "c") {
      setClip({ kind: "notebook", id: notebook.id, name: notebook.name });
      toast.success(`已复制笔记本「${notebook.name}」`);
    } else if (command && key === "v") pasteNotebook();
    else handled = false;
    if (handled) event.preventDefault();
  };

  return (
    <FileActionsContext.Provider value={actions}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-2 pb-1">
          <h2 className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">笔记本</h2>
          <Button type="button" size="icon-sm" variant="ghost" className="ml-auto size-6" aria-label="新建笔记本" disabled={creating} onClick={onCreate}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          </Button>
        </div>
        <ul aria-label="项目里的笔记本" className="grid gap-px px-1">
          {loading ? <li className="px-2 py-1 text-xs text-muted-foreground">读取中…</li> : null}
          {notebooks.map((nb) => (
            <li key={nb.id}>
              <NotebookMenu
                notebook={nb}
                onOpen={() => router.push(`/workbench/${nb.id}`)}
                onDialog={setDialog}
                onPaste={pasteNotebook}
                canPaste={canPasteNotebook}
                onDownload={() => downloadNotebook(nb)}
              >
                <Link
                  href={`/workbench/${nb.id}`}
                  aria-current={nb.id === activeId ? "page" : undefined}
                  className={cn(rowClass, "gap-2 px-2", nb.id === activeId && "bg-primary/12 font-medium text-primary hover:bg-primary/15")}
                  onKeyDown={notebookKeysFor(nb)}
                >
                  <NotebookText className="size-3.5 shrink-0 opacity-70" aria-hidden />
                  <span className="truncate">{nb.name}</span>
                </Link>
              </NotebookMenu>
            </li>
          ))}
        </ul>
        {/* Empty-area menu only — never wraps rows (nested ContextMenu breaks left-clicks). */}
        {!loading && notebooks.length === 0 ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="mx-1 rounded-md px-2 py-2 text-xs text-muted-foreground" aria-label="笔记本区空白处">
                暂无笔记本，右键新建或粘贴
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-40" aria-label="笔记本区的操作">
              <ContextMenuItem disabled={creating} onSelect={onCreate}>
                <Plus /> 新建笔记本
              </ContextMenuItem>
              <ContextMenuItem disabled={!canPasteNotebook} onSelect={pasteNotebook}>
                <ClipboardPaste /> 粘贴{clip?.kind === "notebook" ? `「${clip.name}」` : ""}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : null}

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
          <Button type="button" size="icon-sm" variant="ghost" className="size-6" aria-label="刷新文件" onClick={entries.refresh}>
            <RefreshCw />
          </Button>
        </div>
        {/* The workspace is where notebooks and workflows read files: drop files or folders here to upload them. */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
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
              <Listing path={project.path} depth={0} />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-40" aria-label="文件区的操作">
            <ContextMenuItem disabled={!canPasteFiles} onSelect={() => actions.paste("")}>
              <ClipboardPaste /> 粘贴到项目文件夹
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setDialog({ kind: "new-folder", parent: "" })}>
              <FolderPlus /> 新建文件夹
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => fileInput.current?.click()}>
              <Upload /> 上传到 data/
            </ContextMenuItem>
            <ContextMenuItem onSelect={entries.refresh}>
              <RefreshCw /> 刷新
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      <WorkspacePreviewDialog
        project={project}
        entry={dialog?.kind === "preview" ? dialog.entry : null}
        path={dialog?.kind === "preview" ? relativeToProject(project, dialog.entry.path) : ""}
        onClose={() => setDialog(null)}
        onDownload={actions.download}
      />
      <NameDialog
        open={dialog?.kind === "rename-file" || dialog?.kind === "rename-notebook" || dialog?.kind === "new-folder"}
        title={dialog?.kind === "new-folder" ? "新建文件夹" : dialog?.kind === "rename-notebook" ? "重命名笔记本" : "重命名"}
        description={
          dialog?.kind === "new-folder"
            ? `在 ${dialog.parent || "项目文件夹"} 里`
            : dialog?.kind === "rename-notebook"
              ? "笔记本文件 notebooks/*.ipynb 会跟着改名"
              : dialog?.kind === "rename-file"
                ? relativeToProject(project, dialog.entry.path)
                : undefined
        }
        initial={dialog?.kind === "rename-file" ? dialog.entry.name : dialog?.kind === "rename-notebook" ? dialog.notebook.name : ""}
        selectStem={dialog?.kind === "rename-file" && dialog.entry.kind === "file"}
        maxLength={dialog?.kind === "rename-notebook" ? 80 : 255}
        pending={busy || renameNotebook.isPending}
        submitLabel={dialog?.kind === "new-folder" ? "创建" : "重命名"}
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          if (dialog?.kind === "rename-file") {
            const path = relativeToProject(project, dialog.entry.path);
            void run(() => entries.rename(path, name), `已重命名为 ${name}`);
          } else if (dialog?.kind === "new-folder") {
            void run(() => entries.createFolder(dialog.parent, name), `已创建 ${dialog.parent ? `${dialog.parent}/` : ""}${name}`);
          } else if (dialog?.kind === "rename-notebook") {
            renameNotebook.mutate(
              { id: dialog.notebook.id, name },
              { onSuccess: () => { toast.success(`已重命名为「${name}」`); setDialog(null); }, onError: (error) => toast.error(errorText(error)) },
            );
          }
        }}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete-file" || dialog?.kind === "delete-notebook"}
        title={dialog?.kind === "delete-notebook" ? `删除笔记本「${dialog.notebook.name}」？` : dialog?.kind === "delete-file" ? `删除「${dialog.entry.name}」？` : ""}
        description={
          dialog?.kind === "delete-notebook"
            ? "笔记本和它在 notebooks/ 里的 .ipynb 文件都会删除，无法撤销。已发布的模块不受影响。"
            : dialog?.kind === "delete-file" && dialog.entry.kind === "directory"
              ? "文件夹和里面的所有内容都会从磁盘上删除，无法撤销。"
              : "文件会从磁盘上删除，无法撤销。"
        }
        pending={busy || deleteNotebook.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind === "delete-file") {
            const path = relativeToProject(project, dialog.entry.path);
            void run(() => entries.remove([path]), `已删除 ${path}`);
          } else if (dialog?.kind === "delete-notebook") {
            const { notebook } = dialog;
            deleteNotebook.mutate(notebook.id, {
              onSuccess: () => {
                toast.success(`已删除笔记本「${notebook.name}」`);
                setDialog(null);
                if (notebook.id === activeId) router.push("/workbench");
              },
              onError: (error) => toast.error(errorText(error)),
            });
          }
        }}
      />
    </FileActionsContext.Provider>
  );
}
