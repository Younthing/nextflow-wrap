"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { groupByCategory, searchModules } from "@/features/workflow/catalog";
import type { ModuleDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { EDITOR_ACTIONS } from "../commands";
import { EDITOR_CHROME_CLASS } from "../marquee-text";
import { categoryColor } from "../port-style";

export const MODULE_DRAG_TYPE = "application/x-nf-module";

function LibraryItem({
  def,
  onAdd,
}: {
  def: ModuleDef;
  onAdd: (def: ModuleDef) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(MODULE_DRAG_TYPE, def.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => onAdd(def)}
          className="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent active:cursor-grabbing"
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: categoryColor(def.category) }}
          />
          <span className="truncate font-mono text-xs">
            {def.builtin ? def.name : def.path}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <div className="font-mono font-semibold">{def.process}</div>
        <div className="mt-1 line-clamp-5">{def.description}</div>
        {def.tools.length > 0 && (
          <div className="mt-1 text-muted-foreground">
            工具：{def.tools.map((t) => t.name).join("、")}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function ModuleLibrary({
  modules,
  syncedAt,
  onAdd,
  className,
}: {
  modules: ModuleDef[];
  syncedAt?: string;
  onAdd: (def: ModuleDef) => void;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const searchKeys = useShortcutLabels(EDITOR_ACTIONS.search.shortcut);
  const groups = React.useMemo(
    () => groupByCategory(searchModules(modules, query)),
    [modules, query],
  );

  return (
    <aside
      aria-label="模块库"
      className={cn(
        EDITOR_CHROME_CLASS,
        "glass flex min-h-0 flex-col rounded-xl",
        className,
      )}
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="text-sm font-semibold">模块库</div>
        <SearchField
          size="compact"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模块"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {groups.map(([category, defs]) => {
            const open = query !== "" || !collapsed.has(category);
            return (
              <div key={category} className="mb-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-1 px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(category)) next.delete(category);
                      else next.add(category);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  {category}
                  <span className="ml-auto tabular-nums">{defs.length}</span>
                </button>
                {open &&
                  defs.map((def) => (
                    <LibraryItem key={def.id} def={def} onAdd={onAdd} />
                  ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        拖到画布或点击添加 · 双击画布或 {searchKeys} 搜索
        {syncedAt && <div>nf-core/modules 同步于 {syncedAt}</div>}
      </div>
    </aside>
  );
}
