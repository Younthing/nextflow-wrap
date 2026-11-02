"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CodeXml, FastForward, Loader2, Play, Plus, X } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotebookAssistant } from "@/features/assistant/modules/surfaces";
import { applyCanvasValues, readCanvasValues, type AppliedValue } from "@/features/notebook/canvas-values";
import { convertNotebook, ConvertError } from "@/features/notebook/convert";
import { dispatchNotebookKey, notebookDraftKey } from "@/features/notebook/edit";
import { COMMAND_HINT, EDIT_HINT, interpretNotebookKey, toNotebookKeyEvent, type NotebookMode } from "@/features/notebook/keyboard";
import { latestModuleForNotebook } from "@/features/notebook/library";
import { useNotebook, useNotebookRevision, useRunNotebook, useSaveNotebook, useScriptModules } from "@/features/notebook/queries";
import { languageForKernel, type CellRunResult, type NotebookCell, type NotebookCellRole, type NotebookDoc, type NotebookRunKernel } from "@/features/notebook/types";
import { ExportMenu } from "@/features/workbench/components/export-menu";
import { KernelControls } from "./kernel-controls";
import { KernelPicker } from "./kernel-picker";
import { CELL_ROLE_LABEL, NotebookCellCard } from "./notebook-cell";

function newCell(role: NotebookCellRole): NotebookCell {
  return { id: `c_${Math.random().toString(36).slice(2, 8)}`, role, source: "" };
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
  const search = useSearchParams();
  const revParam = search.get("rev");
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
  const [outputs, setOutputs] = React.useState<Record<string, CellRunResult>>({});
  const [runningTarget, setRunningTarget] = React.useState<string | "all" | null>(null);
  const [lastKernel, setLastKernel] = React.useState<NotebookRunKernel | null>(null);
  const [mode, setMode] = React.useState<NotebookMode>("command");
  const [deleteArmed, setDeleteArmed] = React.useState(false);
  const [markdownEditId, setMarkdownEditId] = React.useState<string | null>(null);
  const [canvasFor, setCanvasFor] = React.useState<string | null>(null);
  const [fromCanvas, setFromCanvas] = React.useState<{ from: string; applied: AppliedValue[]; skipped: string[]; before: NotebookCell[] } | null>(null);
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

  // Values handed over by a canvas node's </> button land in the input cells once, then the URL is cleaned.
  const canvas = readCanvasValues(search);
  const canvasKey = canvas && notebook.data && !readOnly ? search.toString() : null;
  if (canvasKey !== canvasFor) {
    setCanvasFor(canvasKey);
    if (canvas && canvasKey && notebook.data) {
      const base = override ?? notebook.data;
      let inputs: ReturnType<typeof convertNotebook>["inputs"] = [];
      try {
        inputs = convertNotebook(base).inputs;
      } catch {
        // A notebook that does not convert has no markers to fill.
      }
      const result = applyCanvasValues(base.cells, inputs, canvas.values, base.language);
      if (result.cells.some((cell, i) => cell !== base.cells[i])) {
        setOverride({ ...base, cells: result.cells });
        setDirty(true);
      }
      setFromCanvas({
        from: canvas.from,
        applied: result.applied,
        skipped: Object.keys(canvas.values).filter((name) => !result.applied.some((item) => item.name === name)),
        before: base.cells,
      });
    }
  }
  React.useEffect(() => {
    if (canvasKey) router.replace(`/workbench/${notebookId}`);
  }, [canvasKey, notebookId, router]);

  let converted: ReturnType<typeof convertNotebook> | undefined;
  let convertError = "";
  if (live && marked) {
    try {
      converted = convertNotebook(live);
    } catch (error) {
      convertError = error instanceof ConvertError ? error.message : "还不能生成命令行";
    }
  }
  const ports = { inputs: converted?.inputs.length ?? 0, outputs: converted?.outputs.length ?? 0 };

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

  const insertCell = (role: NotebookCellRole) => {
    const cell = newCell(role);
    const at = selected ? live.cells.findIndex((item) => item.id === selected) : -1;
    const cells = [...live.cells];
    cells.splice(at < 0 ? cells.length : at + 1, 0, cell);
    update({ cells });
    setSelected(cell.id);
  };
  const selectedCell = live.cells.find((cell) => cell.id === selected);
  const openPublish = () => {
    const href = `/workbench/${notebookId}/publish?step=1`;
    if (dirty && override) {
      save.mutate(override, { onSuccess: () => router.push(href) });
      return;
    }
    router.push(href);
  };
  const savedLabel = readOnly
    ? `只读 · 原版 r${live.rev}`
    : save.isPending || dirty
      ? "保存中…"
      : `已自动保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div role="toolbar" aria-label="笔记本工具栏" className="flex flex-wrap items-center gap-1 border-b border-border bg-glass-strong px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="运行当前单元格"
              disabled={runDisabled || !selectedCell || selectedCell.role === "markdown"}
              onClick={() => selected && commitKey(selected, "edit", { key: "Enter", ctrlKey: true, shiftKey: false })}
            >
              <Play />
            </Button>
          </TooltipTrigger>
          <TooltipContent>运行当前单元格 <span className="ml-2 font-mono text-muted-foreground">Ctrl+Enter</span></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="运行全部" disabled={runDisabled} onClick={() => beginRun()}>
              {runningTarget === "all" ? <Loader2 className="animate-spin" /> : <FastForward />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>重启内核后从第一格依次运行，遇到报错停下</TooltipContent>
        </Tooltip>
        {live.language === "python" ? (
          <KernelControls compact notebookId={notebookId} running={runningTarget !== null} disabled={readOnly} />
        ) : null}
        <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
        <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => insertCell("code")}>+ 代码</Button>
        <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => insertCell("markdown")}>+ 说明</Button>
        <Select
          value={selectedCell?.role ?? ""}
          disabled={readOnly || !selectedCell}
          onValueChange={(role) => selected && updateCell(selected, { role: role as NotebookCellRole })}
        >
          <SelectTrigger size="sm" className="h-8 w-28 text-xs" aria-label="当前单元格类型">
            <SelectValue placeholder="单元格类型" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CELL_ROLE_LABEL) as NotebookCellRole[]).map((role) => (
              <SelectItem key={role} value={role}>{CELL_ROLE_LABEL[role]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {published ? (
            <Badge variant={published.tryRun === "failed" ? "outline" : "success"}>模块 {published.version}</Badge>
          ) : null}
          {live.libraryModuleId ? <Badge variant="outline">库重建</Badge> : null}
          <KernelPicker
            subtle
            value={live.kernel}
            disabled={readOnly}
            onChange={(kernel) => update({ kernel, language: languageForKernel(kernel) })}
          />
          <ExportMenu
            doc={live}
            outputs={outputs}
            ports={ports}
            published={published?.version}
            disabled={readOnly}
            onExportModule={openPublish}
          />
        </div>
      </div>

      {readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          正在查看钉住的原版 r{live.rev}。这一页只读，改最新笔记本不会改写这个修订。
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href={`/workbench/${notebookId}`}>打开最新 r{notebook.data.rev}</Link>
          </Button>
        </div>
      )}

      {fromCanvas && !readOnly && (
        <div role="status" className="flex flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm">
          <CodeXml className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            {fromCanvas.applied.length ? (
              <>
                已从画布节点 <span className="font-mono">{fromCanvas.from}</span> 填入
                {fromCanvas.applied.map((item, i) => (
                  <React.Fragment key={item.name}>
                    {i ? "、" : " "}
                    <code className="font-mono text-xs">{item.name} = {item.literal}</code>
                  </React.Fragment>
                ))}
                。运行单元格就会用这些值。
              </>
            ) : (
              <>画布节点 <span className="font-mono">{fromCanvas.from}</span> 没有可以填入的值。</>
            )}
            {fromCanvas.skipped.length > 0 && (
              <span className="text-muted-foreground"> 笔记本里没有输入 {fromCanvas.skipped.join("、")}，已跳过。</span>
            )}
          </span>
          {fromCanvas.applied.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                update({ cells: fromCanvas.before });
                setFromCanvas(null);
              }}
            >
              撤销
            </Button>
          )}
          <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭提示" onClick={() => setFromCanvas(null)}>
            <X />
          </Button>
        </div>
      )}

      {live.libraryModuleId && (
        <div className="border-b border-border px-4 py-2 text-sm">
          <span className="font-medium">从模块库重建的可编辑副本</span>
          <span className="text-muted-foreground">
            {" "}· {live.libraryModuleId}
            {live.librarySourceNotebookId ? (
              <>
                {" "}· 源笔记本{" "}
                <Link href={`/workbench/${live.librarySourceNotebookId}`} className="text-primary hover:underline">
                  {live.librarySourceNotebookId}
                </Link>
                {live.librarySourceNotebookRev !== undefined ? ` r${live.librarySourceNotebookRev}` : ""}
              </>
            ) : null}
            。改这本不会改源笔记本，也不会改已发布的模块。
          </span>
        </div>
      )}

      {marked && converted ? (
        <div aria-label="模块端口" role="group" className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="font-sans">模块端口</span>
          {converted.inputs.map((input) => (
            <span key={`in:${input.name}`} className="rounded-full bg-port-value/12 px-2 py-0.5 text-foreground">入 · {input.name} · {input.type}{input.required ? " · 必填" : ""}</span>
          ))}
          {converted.outputs.map((output) => (
            <span key={`out:${output.name}`} className="rounded-full bg-port-file/15 px-2 py-0.5 text-foreground">出 · {output.name} · {output.pattern}</span>
          ))}
        </div>
      ) : marked && convertError ? (
        <p role="status" className="border-b border-border px-4 py-1.5 text-xs text-destructive">{convertError}</p>
      ) : null}

      {lastKernel?.note ? (
        <p role="status" className="border-b border-border bg-warning/10 px-4 py-2 text-xs text-foreground">
          {lastKernel.note}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-5xl gap-2 px-4 pt-6 pb-24">
          <div className="grid gap-0.5 pl-12">
            <input
              value={live.name}
              disabled={readOnly}
              aria-label="笔记本名称"
              onChange={(event) => update({ name: event.target.value })}
              className="w-full rounded-md bg-transparent px-2 py-1 font-serif text-2xl font-bold outline-none placeholder:text-muted-foreground hover:bg-accent/60 focus-visible:bg-accent/60 disabled:opacity-100"
            />
            <input
              value={live.description}
              disabled={readOnly}
              aria-label="笔记本说明"
              placeholder="这本笔记本在做什么"
              onChange={(event) => update({ description: event.target.value })}
              className="w-full rounded-md bg-transparent px-2 py-0.5 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/70 hover:bg-accent/60 focus-visible:bg-accent/60"
            />
          </div>
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
          {!readOnly ? (
            <div className="flex gap-1 pl-12 opacity-70 transition-opacity hover:opacity-100">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected(live.cells.at(-1)?.id ?? null); insertCell("code"); }} aria-label="在末尾添加代码单元格">
                <Plus /> 代码
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected(live.cells.at(-1)?.id ?? null); insertCell("markdown"); }} aria-label="在末尾添加说明单元格">
                <Plus /> 说明
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {(save.error || run.error) && <p role="alert" className="border-t border-border px-4 py-2 text-sm text-destructive">{save.error?.message ?? run.error?.message}</p>}
      <footer className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate" title={mode === "command" ? COMMAND_HINT : EDIT_HINT}>{mode === "command" ? COMMAND_HINT : EDIT_HINT}</span>
        <span className="ml-auto shrink-0">{live.language === "python" ? "常驻内核 · 变量会保留" : "每次从头运行"}</span>
        <span className="shrink-0">{savedLabel}</span>
      </footer>
    </div>
  );
}
