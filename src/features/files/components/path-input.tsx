"use client";

import * as React from "react";
import { File, FolderOpen, Folder, ArrowUp, Home } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { nativeDialogs, type PickPathOptions } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { useFileIntake, useFsListing } from "../queries";
import type { FsEntry } from "../types";

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

/** Browses the server's files through `/api/fs/list`: the picker everywhere except a desktop app with a local server. */
export function PathBrowserDialog({
  open,
  onOpenChange,
  options,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: PickPathOptions;
  onPick: (path: string) => void;
}) {
  const [path, setPath] = React.useState<string | undefined>(options.defaultPath || undefined);
  const [selected, setSelected] = React.useState<string>();
  const listing = useFsListing(path, open);
  const entries = listing.data?.entries.filter((entry) => entry.kind === "directory" || (options.kind === "file" && matches(entry, options.extensions))) ?? [];
  const current = listing.data?.path;
  const choice = options.kind === "directory" ? selected ?? current : selected;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{options.title ?? (options.kind === "directory" ? "选择文件夹" : "选择文件")}</DialogTitle>
          <DialogDescription className="sr-only">按路径引用，不上传</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="上一级" disabled={!listing.data?.parent} onClick={() => { setPath(listing.data?.parent); setSelected(undefined); }}><ArrowUp /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="主目录" onClick={() => { setPath(listing.data?.home); setSelected(undefined); }}><Home /></Button>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={current}>{current ?? "…"}</code>
        </div>
        <ul role="listbox" aria-label="文件列表" className="glass h-72 overflow-y-auto rounded-md p-1 text-sm">
          {listing.isError && <li className="p-2 text-destructive">{listing.error.message}</li>}
          {listing.isSuccess && entries.length === 0 && <li className="p-2 text-muted-foreground">这里没有可选的项目</li>}
          {entries.map((entry) => {
            const Icon = entry.kind === "directory" ? Folder : File;
            return (
              <li
                key={entry.path}
                role="option"
                aria-selected={selected === entry.path}
                tabIndex={0}
                className={cn("flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-accent", selected === entry.path && "bg-primary/15")}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => {
                  if (entry.kind === "directory") { setPath(entry.path); setSelected(undefined); }
                  else { onPick(entry.path); onOpenChange(false); }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  if (entry.kind === "directory") { setPath(entry.path); setSelected(undefined); }
                  else { onPick(entry.path); onOpenChange(false); }
                }}
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
          <Button disabled={!choice} onClick={() => { if (choice) { onPick(choice); onOpenChange(false); } }}>
            {options.kind === "directory" ? "选择这个文件夹" : "选择"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Text field for a server path with a browse button, a drop target and file paste. Browse opens the native dialog
 * only when the server runs on this computer, and otherwise browses the server. Dropped files are used where they
 * are when the server can reach them (local, WSL), and uploaded into the project's `data/` otherwise.
 */
export function PathInput({
  value,
  onChange,
  kind = "file",
  extensions,
  upload = false,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  kind?: PickPathOptions["kind"];
  extensions?: string[];
  /** Data inputs: files dropped from a computer the server cannot read are uploaded into the project's `data/`. */
  upload?: boolean;
}) {
  const [browsing, setBrowsing] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const options: PickPathOptions = { kind, extensions, defaultPath: value || undefined };
  const intake = useFileIntake();
  const take = (transfer: DataTransfer) => {
    void intake(transfer, { upload }).then(([first]) => { if (first) onChange(first.path); });
  };
  const browse = async () => {
    const bridge = nativeDialogs();
    if (!bridge) { setBrowsing(true); return; }
    const [picked] = await bridge.pickPath(options);
    if (picked) onChange(picked);
  };
  return (
    <div
      className={cn("flex items-center gap-1 rounded-md", dragging && "ring-2 ring-primary/60")}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
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
      <Button type="button" size="icon-sm" variant="ghost" aria-label={kind === "directory" ? "浏览文件夹" : "浏览文件"} onClick={() => void browse()}>
        <FolderOpen />
      </Button>
      {browsing && <PathBrowserDialog open={browsing} onOpenChange={setBrowsing} options={options} onPick={onChange} />}
    </div>
  );
}
