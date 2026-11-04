"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { EnvConfigAssistant } from "@/features/assistant/surfaces/prompt-only";
import { ModuleEnvEditor } from "@/features/notebook/components/module-env-form";
import { useEditModule, useScriptModules } from "@/features/notebook/queries";
import type { ScriptModuleView } from "@/features/notebook/library";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { isCatalogBuiltin, moduleOrigin } from "@/features/workflow/origin";
import type { ModuleDef, PortDef } from "@/features/workflow/types";
import { cn } from "@/lib/utils";

type CatalogFilter = "both" | "script" | "builtin";

const BUILTIN_ORDER = [
  "builtin/file",
  "builtin/folder",
  "builtin/samplesheet",
  "builtin/merge-samplesheet",
  "builtin/branch",
  "builtin/collect-summary",
  "builtin/export-results",
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
  const editModule = useEditModule();
  const [editError, setEditError] = React.useState<string | null>(null);
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
  const selected = scriptRows.find((row) => row.id === selectedId);
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
        </div>
        <Button asChild>
          <Link href="/workbench">从笔记本导出</Link>
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
        {envModule ? <ModuleEnvEditor key={envModule.id} module={envModule} /> : null}
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
                        {script ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`在笔记本中编辑 ${script.name}`}
                            disabled={editModule.isPending}
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditError(null);
                              editModule.mutate(script.id, {
                                onSuccess: (doc) => router.push(`/workbench/${doc.id}`),
                                onError: (error) => setEditError(error instanceof Error ? error.message : "无法打开"),
                              });
                            }}
                          >
                            {editModule.isPending && editModule.variables === script.id ? <Loader2 className="animate-spin" /> : null}
                            在笔记本中编辑
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
      </div>

      {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}

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
