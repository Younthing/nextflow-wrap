"use client";

import { useSyncExternalStore } from "react";
import { dirtyDocument, subscribeDocument } from "../document-sessions";
import Link from "next/link";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

function DirtyMark({ id }: { id: string }) {
  const dirty = useSyncExternalStore((listener) => subscribeDocument(id, listener), () => dirtyDocument(id), () => false);
  return dirty ? <span aria-label="未保存">●</span> : null;
}

/** Open notebooks as tabs. Middle click or × closes one. */
export function WorkbenchTabs({
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
    <nav aria-label="打开的文件" className="flex min-w-0 items-end gap-0.5 overflow-x-auto border-b border-border px-2 pt-1.5">
      {tabs.map((id) => {
        const selected = id === active;
        const name = names[id] ?? decodeURIComponent(id.split("/").slice(1).join("/") || id);
        return (
          <div
            key={id}
            className={cn(
              "group flex h-8 max-w-52 shrink-0 items-center gap-1 rounded-t-lg pr-1 pl-3 text-[13px]",
              selected ? "bg-glass-strong font-medium text-foreground shadow-[0_-1px_0_var(--border)]" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(id); } }}
          >
            <Link href={`/workbench/${id}`} aria-current={selected ? "page" : undefined} className="truncate outline-none focus-visible:underline" title={name}>
              {name} <DirtyMark id={id} />
            </Link>
            <button
              type="button"
              aria-label={`关闭 ${name}`}
              className={cn("grid size-5 shrink-0 place-items-center rounded hover:bg-accent", selected ? "opacity-70" : "opacity-0 group-hover:opacity-70 focus-visible:opacity-100")}
              onClick={() => onClose(id)}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
