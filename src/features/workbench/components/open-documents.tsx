"use client";

import { useSyncExternalStore } from "react";
import { dirtyDocument, subscribeDocument } from "../document-sessions";
import Link from "next/link";
import { FileText, NotebookText, Workflow, X } from "lucide-react";

import { cn } from "@/lib/utils";

function DirtyMark({ id }: { id: string }) {
  const dirty = useSyncExternalStore((listener) => subscribeDocument(id, listener), () => dirtyDocument(id), () => false);
  return dirty ? <span aria-label="未保存">●</span> : null;
}

/** Open files for this project and window. Middle click or × closes one. */
export function OpenDocuments({
  tabs,
  names,
  active,
  onClose,
}: {
  tabs: string[];
  names: Record<string, string>;
  active?: string;
  onClose: (id: string) => void;
}) {
  if (!tabs.length) return null;
  return (
    <ul aria-label="工作台标签页" className="grid gap-0.5">
      {tabs.map((id) => {
        const selected = id === active;
        const name = names[id] ?? decodeURIComponent(id.split("/").slice(1).join("/") || id);
        const Icon = id.startsWith("workflow/") ? Workflow : id.startsWith("file/") ? FileText : NotebookText;
        return (
          <li
            key={id}
            className={cn(
              "group flex h-8 min-w-0 items-center gap-1 rounded-md pr-1 text-[13px]",
              selected ? "bg-accent font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(id); } }}
          >
            <Link href={`/workbench/${id}`} aria-current={selected ? "page" : undefined} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none" title={name}>
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{name}</span><DirtyMark id={id} />
            </Link>
            <button
              type="button"
              aria-label={`关闭 ${name}`}
              className={cn("grid size-5 shrink-0 place-items-center rounded hover:bg-accent", selected ? "opacity-70" : "opacity-0 group-hover:opacity-70 focus-visible:opacity-100")}
              onClick={() => onClose(id)}
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
