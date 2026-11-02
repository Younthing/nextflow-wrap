"use client";

import * as React from "react";
import { ArrowUp, File, Folder, FolderOpen, Home, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toWorkspacePath } from "@/features/workspace/paths";
import { useCurrentProject } from "@/features/workspace/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFileIntake, useFsListing } from "../queries";
import type { FsEntry, PickOptions } from "../types";

const sizeLabel = (bytes?: number) => {
  if (bytes === undefined) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const matches = (entry: FsEntry, extensions?: string[]) =>
  !extensions?.length || extensions.some((ext) => entry.name.toLowerCase().endsWith(`.${ext.toLowerCase()}`));

/** `path` is `root` or inside it. */
export const withinRoot = (path: string, root?: string) => !root || path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * Picks a path on the server through `/api/fs/list`, the same in a browser and in the desktop app. With a `root`
 * (the workspace) it stays inside that folder and offers an upload, which lands in the project's `data/`.
 */
export function PathBrowserDialog({
  open,
  onOpenChange,
  options,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: PickOptions;
  onPick: (path: string) => void;
}) {
  const { root } = options;
  const start = options.defaultPath && withinRoot(options.defaultPath, root) ? options.defaultPath : root;
  const [path, setPath] = React.useState<string | undefined>(start || undefined);
  const [selected, setSelected] = React.useState<string>();
  const listing = useFsListing(path, open);
  const intake = useFileIntake();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const entries = listing.data?.entries.filter((entry) => entry.kind === "directory" || (options.kind === "file" && matches(entry, options.extensions))) ?? [];
  const current = listing.data?.path;
  const parent = listing.data?.parent && withinRoot(listing.data.parent, root) && current !== root ? listing.data.parent : undefined;
  const choice = options.kind === "directory" ? selected ?? current : selected;
  const go = (next: string | undefined) => { setPath(next); setSelected(undefined); };
  const pick = (picked: string) => { onPick(picked); onOpenChange(false); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{options.title ?? (options.kind === "directory" ? "选择文件夹" : "选择文件")}</DialogTitle>
          <DialogDescription className="sr-only">{root ? "工作区里的文件" : "服务端上的文件"}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="上一级" disabled={!parent} onClick={() => go(parent)}><ArrowUp /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={root ? "工作区" : "主目录"} onClick={() => go(root ?? listing.data?.home)}><Home /></Button>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={current}>{current ?? "…"}</code>
          {root ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}><Upload />上传</Button>
              <input
                ref={fileInput}
                type="file"
                multiple={false}
                hidden
                aria-label="上传文件"
                onChange={(event) => {
                  const files = event.target.files;
                  if (!files?.length) return;
                  void intake(files).then(([first]) => { if (first) pick(first.path); });
                  event.target.value = "";
                }}
              />
            </>
          ) : null}
        </div>
        <ul role="listbox" aria-label="文件列表" className="glass h-72 overflow-y-auto rounded-md p-1 text-sm">
          {listing.isError && <li className="p-2 text-destructive">{listing.error.message}</li>}
          {listing.isSuccess && entries.length === 0 && <li className="p-2 text-muted-foreground">这里没有可选的项目</li>}
          {entries.map((entry) => {
            const Icon = entry.kind === "directory" ? Folder : File;
            const enter = () => (entry.kind === "directory" ? go(entry.path) : pick(entry.path));
            return (
              <li
                key={entry.path}
                role="option"
                aria-selected={selected === entry.path}
                tabIndex={0}
                className={cn("flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-accent", selected === entry.path && "bg-primary/15")}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={enter}
                onKeyDown={(event) => { if (event.key === "Enter") enter(); }}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{entry.name}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{sizeLabel(entry.size)}</span>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="glass" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!choice} onClick={() => { if (choice) pick(choice); }}>
            {options.kind === "directory" ? "选择这个文件夹" : "选择"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A server path with a browse button. `workspace` marks data inputs (canvas nodes, workflow params, try-run inputs):
 * they browse the open project only, and dropped or pasted files are uploaded into its `data/`. Other fields
 * (an interpreter, a key file, a project's parent folder) browse the whole server and take no files.
 */
export function PathInput({
  value,
  onChange,
  kind = "file",
  extensions,
  workspace = false,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  kind?: PickOptions["kind"];
  extensions?: string[];
  workspace?: boolean;
}) {
  const [browsing, setBrowsing] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const { project } = useCurrentProject();
  const root = workspace ? project?.path : undefined;
  // Data inputs store workspace paths (`data/reads.fq`); the server resolves them when it runs.
  const store = (path: string) => onChange(workspace ? toWorkspacePath(path, root) : path);
  const shown = root && value && !value.startsWith("/") ? `${root}/${value}` : value;
  const options: PickOptions = { kind, extensions, defaultPath: shown || undefined, root };
  const intake = useFileIntake();
  const take = (transfer: DataTransfer) => {
    if (!workspace) { toast.warning("这里需要服务端上的路径，请点浏览选择"); return; }
    void intake(transfer).then(([first]) => { if (first) store(first.path); });
  };
  return (
    <div
      className={cn("flex items-center gap-1 rounded-md", dragging && "ring-2 ring-primary/60")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        // Taken here either way, so the browser does not open the file in place of the app.
        event.preventDefault();
        if (workspace) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        take(event.dataTransfer);
      }}
      onPaste={(event) => {
        // Text pastes into the field as usual; only pasted files are taken.
        if (!event.clipboardData.files.length) return;
        event.preventDefault();
        take(event.clipboardData);
      }}
    >
      <Input value={value} onChange={(event) => onChange(event.target.value)} className={cn("font-mono", className)} {...props} />
      <Button type="button" size="icon-sm" variant="ghost" aria-label={kind === "directory" ? "浏览文件夹" : "浏览文件"} onClick={() => setBrowsing(true)}>
        <FolderOpen />
      </Button>
      {browsing && <PathBrowserDialog open={browsing} onOpenChange={setBrowsing} options={options} onPick={store} />}
    </div>
  );
}
