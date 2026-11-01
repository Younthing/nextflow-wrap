"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, NotebookText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { EnvConfigAssistant } from "@/features/assistant/modules/surfaces";
import { ModuleEnvEditor } from "@/features/notebook/components/module-env-form";
import { SourceDriftBanner } from "@/features/notebook/components/source-drift-banner";
import { useReopenLibraryNotebook, useScriptModules } from "@/features/notebook/queries";
import type { ScriptModuleView } from "@/features/notebook/library";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
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
  const router = useRouter();
  const scripts = useScriptModules();
  const reopen = useReopenLibraryNotebook();
  const [reopenError, setReopenError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<CatalogFilter>("both");
  const [query, setQuery] = React.useState("");
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
  const counts = {
    both: scriptRows.length + builtins.length,
    script: scriptRows.length,
    builtin: builtins.length,
  };
  const selected = scriptRows.find((row) => row.id === (selectedId ?? scriptRows.find((row) => row.sourceChanged)?.id));
  const envModule = selected && primary.some((row) => row.id === selected.id) ? selected : undefined;

  return (
    <section className="glass flex size-full flex-col gap-4 overflow-hidden rounded-xl p-5">
      <EnvConfigAssistant />
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            <Link href="/workflows" className="hover:underline">流程</Link>
            <span> / 模块库</span>
          </div>
          <h1 className="mt-1 font-serif text-xl font-semibold">模块库</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            已发布模块，挂在「流程」之下：自定义（笔记本发布）和内置功能节点。新模块请在笔记本里发布。
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
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto">
        {envModule ? <ModuleEnvEditor key={envModule.id} module={envModule} /> : scripts.data ? (
          <p className="text-xs text-muted-foreground">点一个自定义模块，手填它的 Conda yaml 和容器。这两项写入 ModuleDef，并出现在生成的 process 里。</p>
        ) : null}
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
                      <div className="flex flex-wrap justify-end gap-1">
                        {script?.sourceNotebookId ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`从库重建 ${script.name} ${script.version ?? ""}`.trim()}
                              disabled={reopen.isPending}
                              onClick={(event) => {
                                event.stopPropagation();
                                setReopenError(null);
                                reopen.mutate(script.id, {
                                  onSuccess: (doc) => router.push(`/notebooks/${doc.id}`),
                                  onError: (error) => setReopenError(error instanceof Error ? error.message : "无法从库重建"),
                                });
                              }}
                            >
                              {reopen.isPending && reopen.variables === script.id ? <Loader2 className="animate-spin" /> : null}
                              从库重建
                            </Button>
                            <Button asChild variant="outline" size="sm" onClick={(event) => event.stopPropagation()}>
                              <Link href={`/notebooks/${script.sourceNotebookId}`}>在笔记本中打开源</Link>
                            </Button>
                          </>
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
      </div>

      {selectedId && selected && (
        <div className="rounded-lg border border-border px-3 py-2 text-sm">
          <span className="font-medium">{selected.name} · {selected.version}</span>
          <span className="text-muted-foreground">
            {" "}的库副本可以重建成一本新的可编辑笔记本。源笔记本「{selected.sourceNotebookName}」保持原路径，不会被改写。
          </span>
        </div>
      )}

      {reopenError && <p role="alert" className="text-sm text-destructive">{reopenError}</p>}

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
        每个自定义模块记录 sourceNotebookId 与 sourceNotebookRev，并保存一份 jupytext 库副本。「从库重建」按那一版新建可编辑笔记本，不改源笔记本。试跑不通过的版本留在这里，标成「不可拖入画布」，不会出现在画布抽屉。内置节点随产品提供。
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
