"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Loader2, Play } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotebookAssistant } from "@/features/assistant/modules/surfaces";
import { convertNotebook, ConvertError } from "@/features/notebook/convert";
import { dispatchNotebookKey, notebookDraftKey } from "@/features/notebook/edit";
import { COMMAND_HINT, EDIT_HINT, interpretNotebookKey, toNotebookKeyEvent, type NotebookMode } from "@/features/notebook/keyboard";
import { latestModuleForNotebook } from "@/features/notebook/library";
import { useNotebook, useNotebookRevision, useRunNotebook, useSaveNotebook, useScriptModules } from "@/features/notebook/queries";
import { languageForKernel, type CellRunResult, type NotebookCell, type NotebookCellRole, type NotebookDoc, type NotebookRunKernel } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { KernelControls } from "./kernel-controls";
import { KernelPicker } from "./kernel-picker";
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
    <aside className="glass flex min-h-0 flex-col overflow-auto rounded-xl">
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
      </div>
    </aside>
  );
}

export function NotebookEditor({ notebookId }: { notebookId: string }) {
  return (
    <>
      <NotebookAssistant />
      <NotebookEditorScreen notebookId={notebookId} />
    </>
  );
}

function NotebookEditorScreen({ notebookId }: { notebookId: string }) {
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
  const [outputs, setOutputs] = React.useState<Record<string, CellRunResult>>({});
  const [runningTarget, setRunningTarget] = React.useState<string | "all" | null>(null);
  const [lastKernel, setLastKernel] = React.useState<NotebookRunKernel | null>(null);
  const [mode, setMode] = React.useState<NotebookMode>("command");
  const [deleteArmed, setDeleteArmed] = React.useState(false);
  const [markdownEditId, setMarkdownEditId] = React.useState<string | null>(null);
  const [focusTick, setFocusTick] = React.useState<{ id: string; mode: NotebookMode; token: number } | null>(null);
  const focusSerial = React.useRef(0);
  const runningRef = React.useRef<string | null>(null);
  const keyboardRef = React.useRef<{
    doc: NotebookDoc | null;
    mode: NotebookMode;
    deleteArmed: boolean;
    dirty: boolean;
  }>({ doc: null, mode: "command", deleteArmed: false, dirty: false });
  const saveNotebook = save.mutate;
  const selectionKey = `${notebookId}:${revParam ?? "latest"}`;
  const selectionCells = revParam ? revision.data?.cells : notebook.data?.cells;
  if (selectionCells && selectionFor !== selectionKey) {
    setSelectionFor(selectionKey);
    setSelected(selectionCells[0]?.id ?? null);
    setMode("command");
    setDeleteArmed(false);
    setMarkdownEditId(null);
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
    const snapshot = notebookDraftKey(draft);
    const handle = window.setTimeout(() => {
      saveNotebook(draft, {
        onSuccess: (saved) => {
          setOverride((current) => {
            if (!current) return null;
            const same = notebookDraftKey(current) === snapshot;
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

  const live = React.useMemo(() => {
    if (readOnly && notebook.data && revision.data) {
      return { ...notebook.data, cells: revision.data.cells, rev: revision.data.rev };
    }
    return draft;
  }, [readOnly, notebook.data, revision.data, draft]);

  React.useEffect(() => {
    if (!live) return;
    keyboardRef.current = { doc: live, mode, deleteArmed, dirty };
  }, [live, mode, deleteArmed, dirty]);

  const update = (patch: Partial<NotebookDoc>) => {
    if (!notebook.data) return;
    const base = keyboardRef.current.doc ?? override ?? notebook.data;
    const next = { ...base, ...patch };
    keyboardRef.current = {
      doc: next,
      mode: keyboardRef.current.mode,
      deleteArmed: keyboardRef.current.deleteArmed,
      dirty: true,
    };
    setOverride(next);
    setDirty(true);
  };

  const updateCell = (id: string, patch: Partial<NotebookCell>) => {
    const base = keyboardRef.current.doc ?? draft;
    if (!base) return;
    update({ cells: base.cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)) });
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

  const beginRun = (cellId?: string) => {
    if (readOnly || runningRef.current) return;
    runningRef.current = cellId ?? "all";
    setRunningTarget(runningRef.current);
    run.mutate(
      { id: notebookId, cellId },
      {
        onSuccess: (result) => {
          setLastKernel(result.kernel ?? null);
          setOutputs((current) => {
            const next = cellId ? { ...current } : {};
            for (const cell of result.cells) next[cell.id] = cell;
            return next;
          });
        },
        onSettled: () => {
          runningRef.current = null;
          setRunningTarget(null);
        },
      },
    );
  };

  const persistThenRun = async (doc: NotebookDoc, needsSave: boolean, cellId: string | null) => {
    if (readOnly || runningRef.current) return;
    runningRef.current = cellId ?? "save";
    if (cellId) setRunningTarget(cellId);
    try {
      if (needsSave) {
        const snapshot = notebookDraftKey(doc);
        await save.mutateAsync(doc);
        setOverride((current) => {
          if (!current || notebookDraftKey(current) === snapshot) {
            setDirty(false);
            return null;
          }
          return current;
        });
      }
      if (!cellId) return;
      const result = await run.mutateAsync({ id: notebookId, cellId });
      setLastKernel(result.kernel ?? null);
      setOutputs((current) => {
        const next = { ...current };
        for (const cell of result.cells) next[cell.id] = cell;
        return next;
      });
    } catch {
      // save.error / run.error render under the editor.
    } finally {
      runningRef.current = null;
      setRunningTarget(null);
    }
  };

  const requestFocus = (id: string, nextMode: NotebookMode) => {
    focusSerial.current += 1;
    setFocusTick({ id, mode: nextMode, token: focusSerial.current });
  };

  const commitKey = (cellId: string, origin: NotebookMode, event: Parameters<typeof toNotebookKeyEvent>[0]) => {
    const snap = keyboardRef.current;
    const doc = snap.doc ?? live;
    const keyEvent = toNotebookKeyEvent(event);
    if (runningRef.current && interpretNotebookKey(origin, keyEvent, snap.deleteArmed).command?.type === "run") {
      return true;
    }
    const result = dispatchNotebookKey(
      { cells: doc.cells, selectedId: cellId, mode: snap.mode, deleteArmed: snap.deleteArmed },
      cellId,
      origin,
      keyEvent,
      () => newCell("code"),
      readOnly,
    );
    const nextDoc = { ...doc, cells: result.surface.cells };
    const nextDirty = snap.dirty || result.changed;
    keyboardRef.current = {
      doc: nextDoc,
      mode: result.surface.mode,
      deleteArmed: result.surface.deleteArmed,
      dirty: nextDirty,
    };
    if (result.changed) update({ cells: result.surface.cells });
    setSelected(result.surface.selectedId);
    setMode(result.surface.mode);
    setDeleteArmed(result.surface.deleteArmed);
    if (result.focus) requestFocus(result.surface.selectedId, result.surface.mode);
    const markdownTarget = result.surface.cells.find((cell) => cell.id === result.surface.selectedId);
    if (result.focus && result.surface.mode === "edit" && markdownTarget?.role === "markdown") {
      setMarkdownEditId(markdownTarget.id);
    } else if (result.surface.mode === "command") {
      setMarkdownEditId(null);
    }
    if (result.save && (result.run || nextDirty)) {
      void persistThenRun(nextDoc, nextDirty, result.run?.cellId ?? null);
    }
    return result.handled;
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
            {live.libraryModuleId && <Badge variant="outline">库重建</Badge>}
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

      {live.libraryModuleId && (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="font-medium">从模块库重建的可编辑副本</span>
          <span className="text-muted-foreground">
            {" "}· {live.libraryModuleId}
            {live.librarySourceNotebookId ? (
              <>
                {" "}· 源笔记本{" "}
                <Link href={`/notebooks/${live.librarySourceNotebookId}`} className="text-primary hover:underline">
                  {live.librarySourceNotebookId}
                </Link>
                {live.librarySourceNotebookRev !== undefined ? ` r${live.librarySourceNotebookRev}` : ""}
              </>
            ) : null}
            。改这本不会改源笔记本，也不会改已发布的模块。
          </span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="glass flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Button type="button" size="sm" variant="outline" disabled={runDisabled} title="重启内核后从第一个单元格依次运行，遇到报错停下" onClick={() => beginRun()}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              运行全部
            </Button>
            {live.language === "python" ? (
              <KernelControls notebookId={notebookId} running={runningTarget !== null} disabled={readOnly} />
            ) : null}
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
            <div className="ml-auto">
              <KernelPicker
                value={live.kernel}
                disabled={readOnly}
                onChange={(kernel) => update({ kernel, language: languageForKernel(kernel) })}
              />
            </div>
          </div>
          <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            {live.language === "python"
              ? "单元格在常驻 Jupyter 内核里运行，变量和工作目录里的文件会保留。"
              : null}
            内核只决定笔记本里怎么跑；发布页的试跑和模块 conda／容器单独手填，互不覆盖。
          </p>
          {lastKernel?.note ? (
            <p role="status" className="border-b border-border bg-warning/10 px-3 py-2 text-xs text-foreground">
              {lastKernel.note}
            </p>
          ) : null}
          <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            {mode === "command" ? COMMAND_HINT : EDIT_HINT}
          </p>
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
                language={live.language}
                completionScope={live.cells
                  .slice(0, index)
                  .filter((item) => item.role !== "markdown")
                  .map((item) => item.source)
                  .join("\n")}
                selected={selected === cell.id}
                running={runningTarget === "all" || runningTarget === cell.id}
                readOnly={readOnly}
                runDisabled={runDisabled}
                canDelete={live.cells.length > 1}
                output={outputs[cell.id]}
                deleteArmed={deleteArmed}
                editFocusToken={focusTick?.id === cell.id && focusTick.mode === "edit" ? focusTick.token : 0}
                commandFocusToken={focusTick?.id === cell.id && focusTick.mode === "command" ? focusTick.token : 0}
                markdownOpen={markdownEditId === cell.id}
                onSelect={() => {
                  setSelected(cell.id);
                  setDeleteArmed(false);
                }}
                onEnterEdit={() => {
                  setMode("edit");
                  setDeleteArmed(false);
                }}
                onEnterCommand={() => {
                  setMode("command");
                  setDeleteArmed(false);
                  setMarkdownEditId(null);
                  requestFocus(cell.id, "command");
                }}
                onEditKey={(event) => commitKey(cell.id, "edit", event)}
                onCommandKey={(event) => commitKey(cell.id, "command", event)}
                onRun={({ advance }) => {
                  commitKey(cell.id, "edit", {
                    key: "Enter",
                    shiftKey: advance,
                    ctrlKey: !advance,
                  });
                }}
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
