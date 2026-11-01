"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { groupByCategory, searchModules } from "@/features/workflow/catalog";
import { moduleListLabel, moduleOrigin, modulesForDrawer } from "@/features/workflow/origin";
import type { ModuleDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { EDITOR_ACTIONS } from "../commands";
import { EDITOR_CHROME_CLASS } from "../marquee-text";
import { categoryColor } from "../port-style";

export const MODULE_DRAG_TYPE = "application/x-nf-module";

const GROUP_RANK: Record<string, number> = { 自定义: 0, 内置: 1, 输入: 2, 通道: 3 };

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
          <span className="truncate font-mono text-xs">{moduleListLabel(def)}</span>
          {def.version && <span className="ml-auto text-[10px] text-muted-foreground">{def.version}</span>}
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

function Groups({
  modules,
  query,
  collapsed,
  onToggle,
  onAdd,
}: {
  modules: ModuleDef[];
  query: string;
  collapsed: Set<string>;
  onToggle: (category: string) => void;
  onAdd: (def: ModuleDef) => void;
}) {
  const groups = React.useMemo(() => {
    const grouped = groupByCategory(searchModules(modules, query));
    return grouped.sort((a, b) => (GROUP_RANK[a[0]] ?? 10) - (GROUP_RANK[b[0]] ?? 10) || a[0].localeCompare(b[0], "zh"));
  }, [modules, query]);

  return (
    <>
      {groups.map(([category, defs]) => {
        const open = query !== "" || !collapsed.has(category);
        return (
          <div key={category} className="mb-1">
            <button
              type="button"
              className="flex w-full items-center gap-1 px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => onToggle(category)}
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
              {category}
              <span className="ml-auto tabular-nums">{defs.length}</span>
            </button>
            {open && defs.map((def) => <LibraryItem key={def.id} def={def} onAdd={onAdd} />)}
          </div>
        );
      })}
    </>
  );
}

export function ModuleLibrary({
  modules,
  syncedAt,
  onAdd,
  className,
  showNfCore,
  onShowNfCoreChange,
}: {
  modules: ModuleDef[];
  syncedAt?: string;
  onAdd: (def: ModuleDef) => void;
  className?: string;
  showNfCore?: boolean;
  onShowNfCoreChange?: (value: boolean) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set(["通道"]));
  const [openedNf, setOpenedNf] = React.useState<Set<string>>(new Set());
  const [uncontrolledNf, setUncontrolledNf] = React.useState(false);
  const nfOpen = showNfCore ?? uncontrolledNf;
  const setNfOpen = onShowNfCoreChange ?? setUncontrolledNf;
  const searchKeys = useShortcutLabels(EDITOR_ACTIONS.search.shortcut);
  const visible = React.useMemo(() => modulesForDrawer(modules, false), [modules]);
  const nfCore = React.useMemo(
    () => modules.filter((def) => moduleOrigin(def) === "nf-core"),
    [modules],
  );
  const hiddenMatch = query.trim() !== "" && !nfOpen && searchModules(nfCore, query).length > 0;

  return (
    <aside
      aria-label="模块库"
      className={cn(EDITOR_CHROME_CLASS, "glass flex min-h-0 flex-col rounded-xl", className)}
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="text-sm font-semibold">模块库</div>
        <p className="text-[11px] text-muted-foreground">已发布模块 · 试跑通过的自定义 + 内置</p>
        <SearchField
          size="compact"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模块"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <Groups
            modules={visible}
            query={query}
            collapsed={collapsed}
            onAdd={onAdd}
            onToggle={(category) =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(category)) next.delete(category);
                else next.add(category);
                return next;
              })
            }
          />
          {hiddenMatch && (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">nf-core 里有匹配。打开下面的「显示 nf-core」。</p>
          )}
          <div className="mt-2 border-t border-border pt-2">
            <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
              <ChevronRight className={cn("size-3.5", nfOpen && "rotate-90")} />
              <span className="flex-1">nf-core · {nfCore.length} · 只读</span>
              <Switch checked={nfOpen} onCheckedChange={setNfOpen} aria-label="显示 nf-core" />
            </div>
            {nfOpen && (
              <Groups
                modules={nfCore}
                query={query}
                collapsed={new Set(nfCore.map((def) => def.category).filter((category) => !openedNf.has(category)))}
                onAdd={onAdd}
                onToggle={(category) =>
                  setOpenedNf((prev) => {
                    const next = new Set(prev);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
              />
            )}
            {nfOpen && syncedAt && <p className="px-2 py-1 text-[11px] text-muted-foreground">目录只读，同步于 {syncedAt}</p>}
          </div>
        </div>
      </ScrollArea>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        拖到画布或点击添加 · 双击画布或 {searchKeys} 搜索
        <div>
          <Link href="/workflows/modules" className="text-primary hover:underline">管理模块库</Link>
        </div>
      </div>
    </aside>
  );
}
