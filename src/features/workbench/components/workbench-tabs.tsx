"use client";

import Link from "next/link";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

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
    <div role="tablist" aria-label="打开的笔记本" className="flex min-w-0 items-end gap-0.5 overflow-x-auto border-b border-border px-2 pt-1.5">
      {tabs.map((id) => {
        const selected = id === active;
        const name = names[id] ?? "笔记本";
        return (
          <div
            key={id}
            className={cn(
              "group flex h-8 max-w-52 shrink-0 items-center gap-1 rounded-t-lg pr-1 pl-3 text-[13px]",
              selected ? "bg-glass-strong font-medium text-foreground shadow-[0_-1px_0_var(--border)]" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(id); } }}
          >
            <Link href={`/workbench/${id}`} role="tab" aria-selected={selected} className="truncate outline-none focus-visible:underline" title={name}>
              {name}
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
    </div>
  );
}
