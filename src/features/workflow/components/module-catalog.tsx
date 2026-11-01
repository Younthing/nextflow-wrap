"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, NotebookText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { SourceDriftBanner } from "@/features/notebook/components/source-drift-banner";
import { useScriptModules } from "@/features/notebook/queries";
import type { ScriptModuleView } from "@/features/notebook/library";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { useModuleCatalog } from "@/features/workflow/queries";
import { isCatalogBuiltin, moduleOrigin } from "@/features/workflow/origin";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";

type CatalogFilter = "both" | "script" | "builtin";

const BUILTIN_ORDER = [
  "builtin/merge-samplesheet",
  "builtin/branch",
  "builtin/collect-summary",
  "builtin/export-results",
  "builtin/samplesheet",
  "builtin/reference",
];

function portLabel(port: PortDef): string {
  return port.description === "文件列表" ? `${port.name}[]` : port.name;
}

function ioLine(def: ModuleDef): string {
  const left = def.inputs.map(portLabel).join(", ") || "—";
  const right = def.outputs.map(portLabel).join(", ") || "—";
  return `${left} → ${right}`;
}

function matches(def: ModuleDef, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [def.name, def.process, def.path, def.description, ...def.inputs.map((port) => port.name), ...def.outputs.map((port) => port.name)]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function ModuleCatalog() {
  const scripts = useScriptModules();
  const nfcore = useModuleCatalog();
  const [filter, setFilter] = React.useState<CatalogFilter>("both");
  const [query, setQuery] = React.useState("");
  const [showNfCore, setShowNfCore] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [contract, setContract] = React.useState<ModuleDef | null>(null);

  const scriptRows = scripts.data?.modules ?? [];
  const builtins = BUILTIN_MODULES.filter(isCatalogBuiltin).sort(
    (a, b) => BUILTIN_ORDER.indexOf(a.id) - BUILTIN_ORDER.indexOf(b.id),
  );
  const primary = [...scriptRows, ...builtins].filter((def) => {
    if (filter === "script" && moduleOrigin(def) !== "script") return false;
    if (filter === "builtin" && moduleOrigin(def) !== "builtin") return false;
    return matches(def, query);
  });
  const nfRows = showNfCore ? (nfcore.data?.modules ?? []).filter((def) => matches(def, query)) : [];
  const counts = {
    both: scriptRows.length + builtins.length,
    script: scriptRows.length,
    builtin: builtins.length,
  };
  const selected = scriptRows.find((row) => row.id === (selectedId ?? scriptRows.find((row) => row.sourceChanged)?.id));

  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            <Link href="/workflows" className="hover:underline">流程</Link>
            <span> / 模块库</span>
          </div>
          <h1 className="mt-1 font-serif text-xl font-semibold">模块库</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            已发布模块，挂在「流程」之下。默认只列自定义（笔记本发布）和内置功能节点。新模块请在笔记本里发布。nf-core 是可选来源，默认隐藏。
          </p>
        </div>
        <Button asChild>
          <Link href="/notebooks">去笔记本发布</Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["both", "自定义+内置"],
          ["script", "自定义"],
          ["builtin", "内置"],
        ] as const).map(([id, label]) => (
          <Button key={id} type="button" size="sm" variant={filter === id ? "secondary" : "ghost"} onClick={() => setFilter(id)}>
            {label} · {counts[id]}
          </Button>
        ))}
        <div className="min-w-48 flex-1">
          <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模块名、工具、端口类型" aria-label="搜索模块" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          显示 nf-core
          <Switch checked={showNfCore} onCheckedChange={setShowNfCore} />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {scripts.isPending ? (
          <AsyncPlaceholder status="pending" className="h-40" />
        ) : scripts.error ? (
          <AsyncPlaceholder status="error" className="h-auto" message={scripts.error.message} />
        ) : primary.length === 0 ? (
          <AsyncPlaceholder status="empty" className="h-40" description="没有匹配的模块" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模块</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>输入 → 输出</TableHead>
                <TableHead>源笔记本</TableHead>
                <TableHead>试跑</TableHead>
                <TableHead>被引用</TableHead>
                <TableHead className="text-right"><span className="sr-only">操作</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {primary.map((def) => {
                const script = moduleOrigin(def) === "script" ? (def as ScriptModuleView) : undefined;
                const failed = script?.tryRun === "failed";
                return (
                  <TableRow
                    key={def.id}
                    className={cn(selected?.id === def.id && "bg-accent/40")}
                    onClick={() => script && setSelectedId(def.id)}
                  >
                    <TableCell className="max-w-64">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{def.name}</span>
                        {failed && <Badge variant="destructive">不可拖入画布</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{def.description}</div>
                    </TableCell>
                    <TableCell>
                      {script ? (
                        <Badge variant="default">自定义 · {script.version}</Badge>
                      ) : (
                        <Badge variant="secondary">内置</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ioLine(def)}</TableCell>
                    <TableCell>
                      {script?.sourceNotebookId ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <NotebookText className="size-3.5" />
                          {script.sourceNotebookName}
                          {script.sourceChanged && <Badge variant="warning">源已改动</Badge>}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {script ? (
                        <span className={failed ? "text-destructive" : "text-success"}>{failed ? "试跑失败" : "试跑通过"}</span>
                      ) : (
                        <span className="text-muted-foreground">内置 · 免试跑</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {script ? (script.referenceCount ? `${script.referenceCount} 个流程` : "—") : ((scripts.data?.references[def.id] ?? 0) ? `${scripts.data?.references[def.id]} 个流程` : "—")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {script?.sourceNotebookId ? (
                          <Button asChild variant="outline" size="sm" onClick={(event) => event.stopPropagation()}>
                            <Link href={`/notebooks/${script.sourceNotebookId}`}>在笔记本中打开源</Link>
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => setContract(def)}>查看契约</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="mt-3 rounded-lg border border-border">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground" onClick={() => setShowNfCore((value) => !value)}>
            <ChevronRight className={cn("size-4 transition-transform", showNfCore && "rotate-90")} />
            nf-core 模块 · {nfcore.data?.modules.length ?? "…"} 个 · 只读
            <span className="ml-auto">{showNfCore ? "收起" : "显示"}</span>
          </button>
          {showNfCore && (
            <div className="max-h-72 overflow-auto border-t border-border px-3 py-2">
              {nfcore.isPending ? (
                <p className="text-sm text-muted-foreground">正在加载 nf-core 目录…</p>
              ) : nfRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">没有匹配的 nf-core 模块</p>
              ) : (
                <ul className="grid gap-1">
                  {nfRows.slice(0, 80).map((def) => (
                    <li key={def.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-mono">{def.path}</span>
                      <span className="shrink-0 text-muted-foreground">{ioLine(def)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {nfRows.length > 80 && <p className="mt-2 text-xs text-muted-foreground">还有 {nfRows.length - 80} 个，用搜索缩小范围。</p>}
              {nfcore.data?.syncedAt && <p className="mt-2 text-[11px] text-muted-foreground">目录只读，同步于 {nfcore.data.syncedAt}。此页不提供同步。</p>}
            </div>
          )}
        </div>
      </div>

      {selected?.sourceChanged && selected.sourceNotebookId && selected.sourceNotebookRev !== undefined && selected.sourceNotebookRevCurrent !== undefined && (
        <SourceDriftBanner
          notebookId={selected.sourceNotebookId}
          notebookName={selected.sourceNotebookName}
          pinnedRev={selected.sourceNotebookRev}
          currentRev={selected.sourceNotebookRevCurrent}
          cellChanges={selected.cellChanges}
          version={selected.version}
        />
      )}

      <p className="text-xs text-muted-foreground">
        每个自定义模块记录 sourceNotebookId 与 sourceNotebookRev。试跑不通过的版本留在这里，标成「不可拖入画布」，不会出现在画布抽屉。内置节点随产品提供。nf-core 打开「显示 nf-core」后才列出，只读。
      </p>

      <Dialog open={!!contract} onOpenChange={(open) => !open && setContract(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{contract?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{contract?.description}</p>
          <p className="font-mono text-xs">{contract ? ioLine(contract) : ""}</p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
