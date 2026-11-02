"use client";

import * as React from "react";
import { File, FolderOpen, Folder, ArrowUp, Home } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { desktop, type PickPathOptions } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFsListing } from "../queries";
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

/** Folder browser for the web build, reading the runner machine through `/api/fs/list`. */
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
          <DialogDescription>浏览运行这些流程的电脑上的文件。大文件按路径引用，不会上传。</DialogDescription>
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
 * Text field for a local path with a browse button and a drop target. The desktop app opens the native dialog and
 * reads dropped files' real paths; the web build browses the runner machine instead.
 */
export function PathInput({
  value,
  onChange,
  kind = "file",
  extensions,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  kind?: PickPathOptions["kind"];
  extensions?: string[];
}) {
  const [browsing, setBrowsing] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const options: PickPathOptions = { kind, extensions, defaultPath: value || undefined };
  const browse = async () => {
    const bridge = desktop();
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
        const file = event.dataTransfer.files[0];
        if (!file) return;
        event.preventDefault();
        const path = desktop()?.pathForFile(file);
        if (path) onChange(path);
        else toast.warning("浏览器拿不到文件的本机路径，请用「浏览」选择，或在桌面版里拖入");
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
