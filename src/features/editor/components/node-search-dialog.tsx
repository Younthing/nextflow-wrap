"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { moduleSearchEmptyLabel, modulesForSearch } from "@/features/workflow/module-search";
import { portSignature } from "@/features/workflow/ports";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { categoryColor } from "../port-style";

export interface SearchRequest {
  /** Where the new node goes, in flow coordinates. */
  position: { x: number; y: number };
  /** Set when the search was opened by dropping a link on empty canvas. */
  from?: { nodeId: string; port: PortDef; side: "source" | "target" };
}

export interface SearchPick {
  def: ModuleDef;
  /** The port on the new node to link to `from`, if any. */
  port?: string;
}

export function NodeSearchDialog({
  request,
  modules,
  onPick,
  onClose,
}: {
  request: SearchRequest | null;
  modules: ModuleDef[];
  onPick: (pick: SearchPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const pending = request?.from;
  const results = React.useMemo(
    () => modulesForSearch(modules, query, pending),
    [modules, query, pending],
  );

  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    onPick({ def: r.def, port: r.port?.name });
    setQuery("");
    setActive(0);
  };

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setQuery("");
          setActive(0);
        }
      }}
    >
      <DialogContent showCloseButton={false} className="top-[30%] gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">添加节点</DialogTitle>
        <DialogDescription className="sr-only">搜索模块并添加到画布</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            placeholder={
              pending
                ? `搜索能连接 ${pending.port.name} [${portSignature(pending.port)}] 的模块…`
                : "搜索模块：名称、工具、关键词…"
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(active);
              }
            }}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ScrollArea className="max-h-80">
          <div ref={listRef} className="p-1.5">
            {results.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {moduleSearchEmptyLabel(pending, query)}
              </div>
            )}
            {results.map(({ def, port }, i) => (
              <button
                key={def.id}
                type="button"
                data-index={i}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                  i === active && "bg-accent",
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(def.category) }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-medium">{def.process}</span>
                    <span className="truncate text-xs text-muted-foreground">{def.category}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{def.description}</div>
                </div>
                {port && (
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
                    {port.name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
        <div className="flex gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ 选择</span>
          <span>Enter 添加</span>
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
