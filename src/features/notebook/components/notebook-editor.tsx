"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Loader2, Play } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nextCellId } from "@/features/notebook/cells";
import { convertNotebook, ConvertError } from "@/features/notebook/convert";
import { latestModuleForNotebook } from "@/features/notebook/library";
import { useNotebook, useNotebookRevision, useRunNotebook, useSaveNotebook, useScriptModules } from "@/features/notebook/queries";
import { KERNELS, kernelLabel, type NotebookCell, type NotebookCellRole, type NotebookDoc } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { NotebookCellCard } from "./notebook-cell";

function newCell(role: NotebookCellRole): NotebookCell {
  return { id: `c_${Math.random().toString(36).slice(2, 8)}`, role, source: "" };
}

function PrepPanel({
  doc,
  open,
  onToggle,
}: {
  doc: NotebookDoc;
  open: boolean;
  onToggle: () => void;
}) {
  let converted: ReturnType<typeof convertNotebook> | undefined;
  let error = "";
  try {
    converted = convertNotebook(doc);
  } catch (err) {
    error = err instanceof ConvertError ? err.message : "还不能生成命令行";
  }
  const inputs = converted?.inputs ?? [];
  const outputs = converted?.outputs ?? [];

  return (
    <aside className="glass flex w-80 shrink-0 flex-col rounded-xl">
      <button type="button" className="flex items-center gap-2 px-4 py-3 text-left text-sm font-semibold" onClick={onToggle}>
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        发布准备
      </button>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {!open ? (
          <p className="text-sm text-muted-foreground">还没标输入／输出，这本只是分析。标了 I/O 或点「发布为模块…」时才展开。</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">已标 {inputs.length} 个输入、{outputs.length} 个输出，可以发布。</p>
            {inputs.length > 0 && (
              <ul className="grid gap-1 font-mono text-xs">
                {inputs.map((input) => (
                  <li key={input.name}>入 · {input.name} · {input.type}{input.required ? " · 必填" : ""}</li>
                ))}
              </ul>
            )}
            {outputs.length > 0 && (
              <ul className="grid gap-1 font-mono text-xs">
                {outputs.map((output) => (
                  <li key={output.name}>出 · {output.name} · {output.pattern}</li>
                ))}
              </ul>
            )}
            {inputs.length === 0 && outputs.length === 0 && (
              <p className="text-muted-foreground">用单元格里的 `# @input` / `# @output` 标出端口，或把单元格标为输入、输出。</p>
            )}
          </div>
        )}
        <div className="mt-4 text-xs text-muted-foreground">内核 {kernelLabel(doc.kernel)}</div>
      </div>
    </aside>
  );
}

export function NotebookEditor({ notebookId }: { notebookId: string }) {
  const router = useRouter();
  const revParam = useSearchParams().get("rev");
  const notebook = useNotebook(notebookId);
  const revision = useNotebookRevision(notebookId, revParam);
  const save = useSaveNotebook();
  const run = useRunNotebook();
  const scripts = useScriptModules();
  const published = latestModuleForNotebook(scripts.data?.modules ?? [], notebookId);
  const readOnly = !!revParam;
  const [override, setOverride] = React.useState<NotebookDoc | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectionFor, setSelectionFor] = React.useState<string | null>(null);
  const [prepOverride, setPrepOverride] = React.useState<boolean | null>(null);
  const [outputs, setOutputs] = React.useState<Record<string, { stdout: string; error?: string }>>({});
  const [runningTarget, setRunningTarget] = React.useState<string | "all" | null>(null);
  const saveNotebook = save.mutate;
  const selectionKey = `${notebookId}:${revParam ?? "latest"}`;
  const selectionCells = revParam ? revision.data?.cells : notebook.data?.cells;
  if (selectionCells && selectionFor !== selectionKey) {
    setSelectionFor(selectionKey);
    setSelected(selectionCells[0]?.id ?? null);
  }

  const draft = dirty ? override : notebook.data ?? null;
  const marked = React.useMemo(() => {
    const doc = draft ?? notebook.data;
    if (!doc) return false;
    if (doc.cells.some((cell) => cell.role === "input" || cell.role === "output")) return true;
    return doc.cells.some((cell) => /@input\b|@output\b/.test(cell.source));
  }, [draft, notebook.data]);
  const [trackedMark, setTrackedMark] = React.useState(marked);
  if (marked !== trackedMark) {
    setTrackedMark(marked);
    if (marked) setPrepOverride(null);
  }
  const prepOpen = prepOverride ?? marked;

  React.useEffect(() => {
    if (!draft || !dirty || readOnly) return;
    const snapshot = JSON.stringify(draft.cells) + draft.name + draft.description + draft.kernel;
    const handle = window.setTimeout(() => {
      saveNotebook(draft, {
        onSuccess: (saved) => {
          setOverride((current) => {
            if (!current) return null;
            const same = JSON.stringify(current.cells) + current.name + current.description + current.kernel === snapshot;
            if (same) {
              setDirty(false);
              return null;
            }
            return current;
          });
          return saved;
        },
      });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [draft, dirty, readOnly, saveNotebook]);

  const live = readOnly && notebook.data && revision.data
    ? { ...notebook.data, cells: revision.data.cells, rev: revision.data.rev }
    : draft;

  const update = (patch: Partial<NotebookDoc>) => {
    if (!notebook.data) return;
    setOverride((current) => ({ ...(current ?? notebook.data)!, ...patch }));
    setDirty(true);
  };

  const updateCell = (id: string, patch: Partial<NotebookCell>) => {
    if (!draft) return;
    update({ cells: draft.cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)) });
  };

  let ready = false;
  if (live) {
    try {
      ready = convertNotebook(live).outputs.length > 0;
    } catch {
      ready = false;
    }
  }

  if (notebook.isPending || (readOnly && revision.isPending)) return <AsyncPlaceholder status="pending" className="h-full" />;
  if (notebook.error || !notebook.data) {
    return <AsyncPlaceholder status="error" className="h-auto" message={notebook.error?.message ?? "笔记本不存在"} />;
  }
  if (readOnly && (revision.error || !revision.data)) {
    return <AsyncPlaceholder status="error" className="h-auto" message="这个修订不存在" />;
  }
  if (!live) return <AsyncPlaceholder status="pending" className="h-full" />;

  const savedAt = notebook.data.updatedAt;
  const runDisabled = readOnly || dirty || save.isPending || run.isPending || runningTarget !== null;

  const startRun = (cellId?: string) => {
    if (runDisabled) return;
    setRunningTarget(cellId ?? "all");
    run.mutate(
      { id: notebookId, cellId },
      {
        onSuccess: (result) => {
          setOutputs((current) => {
            const next = cellId ? { ...current } : {};
            for (const cell of result.cells) next[cell.id] = { stdout: cell.stdout, error: cell.error };
            return next;
          });
        },
        onSettled: () => setRunningTarget(null),
      },
    );
  };

  const runCell = (id: string, advance: boolean) => {
    setSelected(advance ? nextCellId(live.cells, id) ?? id : id);
    startRun(id);
  };

  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <header className="glass flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <Link href="/notebooks" className="hover:underline">笔记本</Link>
            <span> / </span>
            <span className="font-mono">{live.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            {published ? (
              <Badge variant={published.tryRun === "failed" ? "outline" : "success"}>已发布为模块 · {published.version}</Badge>
            ) : (
              <Badge variant="secondary">仅分析</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {readOnly ? `只读 · 原版 r${live.rev}` : save.isPending ? "保存中…" : `自动保存于 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`}
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {readOnly && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/notebooks/${notebookId}`}>打开最新 r{notebook.data.rev}</Link>
            </Button>
          )}
          <Button
            type="button"
            variant={ready ? "default" : "outline"}
            disabled={readOnly}
            onClick={() => {
              setPrepOverride(true);
              const href = `/notebooks/${notebookId}/publish?step=1`;
              if (dirty && override) {
                save.mutate(override, { onSuccess: () => router.push(href) });
                return;
              }
              router.push(href);
            }}
          >
            发布为模块…
          </Button>
        </div>
      </header>

      {readOnly && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          正在查看钉住的原版 r{live.rev}。这一页只读，改最新笔记本不会改写这个修订。
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Button type="button" size="sm" variant="outline" disabled={runDisabled} onClick={() => startRun()}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              运行全部
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => {
              const cell = newCell("code");
              update({ cells: [...live.cells, cell] });
              setSelected(cell.id);
            }}>+ 代码</Button>
            <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => {
              const cell = newCell("markdown");
              update({ cells: [...live.cells, cell] });
              setSelected(cell.id);
            }}>+ 说明</Button>
            <Button type="button" size="sm" variant="ghost" disabled={readOnly || !selected} onClick={() => selected && updateCell(selected, { role: "input" })}>标为输入</Button>
            <Button type="button" size="sm" variant="ghost" disabled={readOnly || !selected} onClick={() => selected && updateCell(selected, { role: "output" })}>标为输出</Button>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span>内核</span>
              <Select value={live.kernel} disabled={readOnly} onValueChange={(kernel) => update({ kernel })}>
                <SelectTrigger size="sm" className="w-56 font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KERNELS).map(([id, kernel]) => (
                    <SelectItem key={id} value={id}>{kernel.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            <Input
              value={live.name}
              disabled={readOnly}
              aria-label="笔记本名称"
              onChange={(event) => update({ name: event.target.value })}
              className="h-9 font-medium"
            />
            <Input
              value={live.description}
              disabled={readOnly}
              aria-label="笔记本说明"
              placeholder="这本笔记本在做什么"
              onChange={(event) => update({ description: event.target.value })}
              className="h-8 text-sm"
            />
            {live.cells.map((cell, index) => (
              <NotebookCellCard
                key={cell.id}
                cell={cell}
                index={index}
                selected={selected === cell.id}
                running={runningTarget === "all" || runningTarget === cell.id}
                readOnly={readOnly}
                runDisabled={runDisabled}
                canDelete={live.cells.length > 1}
                output={outputs[cell.id]}
                onSelect={() => setSelected(cell.id)}
                onRun={({ advance }) => runCell(cell.id, advance)}
                onChange={(source) => updateCell(cell.id, { source })}
                onRole={(role) => updateCell(cell.id, { role })}
                onDelete={() => {
                  const remaining = live.cells.filter((item) => item.id !== cell.id);
                  update({ cells: remaining });
                  if (selected === cell.id) setSelected(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
                }}
              />
            ))}
          </div>
        </section>
        <PrepPanel doc={live} open={prepOpen} onToggle={() => setPrepOverride(!prepOpen)} />
      </div>
      {(save.error || run.error) && <p role="alert" className="text-sm text-destructive">{save.error?.message ?? run.error?.message}</p>}
    </div>
  );
}

export function NotebookEditorRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <NotebookEditor notebookId={id} />;
}
