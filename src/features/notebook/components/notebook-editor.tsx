"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { CodeXml, Eraser, FastForward, Loader2, Plus, X } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { newNotebookCell } from "@/features/notebook/assistant-actions";
import { applyCanvasValues, readCanvasValues, type AppliedValue } from "@/features/notebook/canvas-values";
import { convertNotebook } from "@/features/notebook/convert";
import { dispatchNotebookKey, dragOffsets, gapAtPointer, moveCellToGap } from "@/features/notebook/edit";
import { COMMAND_HINT, EDIT_HINT, interpretNotebookKey, toNotebookKeyEvent, type NotebookMode } from "@/features/notebook/keyboard";
import { useKeepNotebook, useNotebook } from "@/features/notebook/queries";
import { useNotebookSession, useNotebookSessionState } from "@/features/notebook/session-provider";
import { languageForKernel, type NotebookCell, type NotebookCellRole, type NotebookDoc } from "@/features/notebook/types";
import { ExportMenu } from "@/features/workbench/components/export-menu";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { KernelControls } from "./kernel-controls";
import { KernelPicker } from "./kernel-picker";
import { CELL_ROLE_LABEL, NotebookCellCard } from "./notebook-cell";

/**
 * The gap between two cells. Like VS Code, hovering it reveals buttons that
 * insert a code or markdown cell right there; after the last cell they stay visible.
 */
/** Lifted copy of a dragged cell that follows the pointer. Portalled to body so no transformed ancestor clips it. */
function DragPreview({
  cell,
  language,
  top,
  left,
  width,
}: {
  cell: NotebookCell;
  language: string;
  top: number;
  left: number;
  width: number;
}) {
  const lines = cell.source.split("\n");
  const shown = lines.slice(0, 8).join("\n");
  return createPortal(
    <div
      aria-hidden
      style={{ top, left, width }}
      className="glass-strong pointer-events-none fixed z-50 scale-[1.02] cursor-grabbing rounded-md border border-primary/50 shadow-2xl"
    >
      <pre className="m-0 max-h-48 overflow-hidden px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
        {shown.trim() ? shown : " "}
        {lines.length > 8 ? <span className="block text-muted-foreground">…</span> : null}
      </pre>
      <div className="flex justify-between px-3 pb-1.5 text-[11px] text-muted-foreground">
        <span>{CELL_ROLE_LABEL[cell.role]}</span>
        <span>{cell.role === "markdown" ? "Markdown" : language}</span>
      </div>
    </div>,
    document.body,
  );
}

function InsertBar({
  after,
  last = false,
  onInsert,
}: {
  after: number;
  last?: boolean;
  onInsert: (role: NotebookCellRole, position: number) => void;
}) {
  const where = after < 0 ? "在开头" : last ? "在末尾" : `在单元格 ${after + 1} 下方`;
  return (
    <div
      className={cn(
        "group/insert relative flex items-center justify-center gap-1 pl-12",
        last ? "h-12 opacity-70 hover:opacity-100" : "h-5 opacity-0 focus-within:opacity-100 hover:opacity-100",
      )}
    >
      {!last ? <span aria-hidden className="absolute inset-x-0 top-1/2 ml-12 h-px bg-border" /> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="relative h-6 gap-1 bg-background px-2 text-xs font-normal"
        aria-label={`${where}添加代码单元格`}
        onClick={() => onInsert("code", after)}
      >
        <Plus /> 代码
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="relative h-6 gap-1 bg-background px-2 text-xs font-normal"
        aria-label={`${where}添加说明单元格`}
        onClick={() => onInsert("markdown", after)}
      >
        <Plus /> 说明
      </Button>
    </div>
  );
}

/**
 * Renders and drives the open {@link NotebookSession}. The draft, outputs,
 * autosave, and runs live in the session, which the assistant uses too.
 */
export function NotebookEditor({ notebookId }: { notebookId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const notebook = useNotebook(notebookId);
  const session = useNotebookSession();
  const keep = useKeepNotebook();
  const saved = useNotebookSessionState((state) => state.saved);
  const draft = useNotebookSessionState((state) => state.draft);
  const outputs = useNotebookSessionState((state) => state.outputs);
  const durations = useNotebookSessionState((state) => state.durations);
  const runningTarget = useNotebookSessionState((state) => state.running);
  const lastKernel = useNotebookSessionState((state) => state.kernel);
  const saving = useNotebookSessionState((state) => state.saving > 0);
  const saveError = useNotebookSessionState((state) => state.saveError);
  const runError = useNotebookSessionState((state) => state.runError);
  const dirty = draft !== null;
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectionFor, setSelectionFor] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<NotebookMode>("command");
  const [deleteArmed, setDeleteArmed] = React.useState(false);
  const [markdownEditId, setMarkdownEditId] = React.useState<string | null>(null);
  /** Cell being dragged by its gutter handle, and the gap (0..cells.length) it would drop into. */
  const [drag, setDragState] = React.useState<{
    id: string;
    gap: number | null;
    pointerY: number;
    /**
     * Cell layout measured when the drag started, in scroll-content coordinates. Cells move by transforms during
     * the drag, so the gap is picked from these untouched positions rather than from the moving boxes.
     */
    layout: { midpoints: number[]; pitches: number[]; left: number; width: number; grab: number };
  } | null>(null);
  /** Pointer handlers read the latest drag here, between renders. */
  const dragRef = React.useRef(drag);
  const setDrag = (next: typeof drag) => {
    dragRef.current = next;
    setDragState(next);
  };
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const cellListRef = React.useRef<HTMLDivElement>(null);
  const [canvasFor, setCanvasFor] = React.useState<string | null>(null);
  const [canvasCells, setCanvasCells] = React.useState<NotebookCell[] | null>(null);
  const [fromCanvas, setFromCanvas] = React.useState<{ from: string; applied: AppliedValue[]; skipped: string[]; before: NotebookCell[] } | null>(null);
  const [focusTick, setFocusTick] = React.useState<{ id: string; mode: NotebookMode; token: number } | null>(null);
  const focusSerial = React.useRef(0);
  /** Mode and delete chord as of the last key, read between renders. The doc is read from the session. */
  const keyboardRef = React.useRef<{ mode: NotebookMode; deleteArmed: boolean }>({ mode: "command", deleteArmed: false });
  const selectionKey = notebookId;
  const selectionCells = saved?.cells;
  if (selectionCells && selectionFor !== selectionKey) {
    setSelectionFor(selectionKey);
    setSelected(selectionCells[0]?.id ?? null);
    setMode("command");
    setDeleteArmed(false);
    setMarkdownEditId(null);
  }

  const live = draft ?? saved;
  const marked = React.useMemo(() => {
    if (!live) return false;
    if (live.cells.some((cell) => cell.role === "input" || cell.role === "output")) return true;
    return live.cells.some((cell) => /@input\b|@output\b/.test(cell.source));
  }, [live]);

  React.useEffect(() => {
    keyboardRef.current = { mode, deleteArmed };
  }, [mode, deleteArmed]);

  // A tool that edits the session asks the editor to show the cell it touched.
  React.useEffect(
    () =>
      session.onReveal((cellId) => {
        setSelected(cellId);
        setDeleteArmed(false);
      }),
    [session],
  );

  const update = (patch: Partial<NotebookDoc>) => session.update(patch);

  const updateCell = (id: string, patch: Partial<NotebookCell>) => {
    const base = session.doc();
    if (!base) return;
    update({ cells: base.cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)) });
  };

  // Values handed over by a canvas node's </> button land in the input cells once, then the URL is cleaned.
  const canvas = readCanvasValues(search);
  const canvasKey = canvas && saved ? search.toString() : null;
  if (canvasKey !== canvasFor) {
    setCanvasFor(canvasKey);
    if (canvas && canvasKey && live) {
      const base = live;
      let inputs: ReturnType<typeof convertNotebook>["inputs"] = [];
      try {
        inputs = convertNotebook(base).inputs;
      } catch {
        // A notebook that does not convert has no markers to fill.
      }
      const result = applyCanvasValues(base.cells, inputs, canvas.values, base.language);
      if (result.cells.some((cell, i) => cell !== base.cells[i])) setCanvasCells(result.cells);
      setFromCanvas({
        from: canvas.from,
        applied: result.applied,
        skipped: Object.keys(canvas.values).filter((name) => !result.applied.some((item) => item.name === name)),
        before: base.cells,
      });
    }
  }
  // The session is outside React state, so the filled cells are written after render.
  React.useLayoutEffect(() => {
    if (canvasCells) session.update({ cells: canvasCells });
  }, [canvasCells, session]);
  React.useEffect(() => {
    if (canvasKey) router.replace(`/workbench/${notebookId}`);
  }, [canvasKey, notebookId, router]);

  let converted: ReturnType<typeof convertNotebook> | undefined;
  if (live && marked) {
    try {
      converted = convertNotebook(live);
    } catch {
      // Export menu shows 0 ports when markers do not convert yet.
    }
  }
  const ports = { inputs: converted?.inputs.length ?? 0, outputs: converted?.outputs.length ?? 0 };

  // Scroll while the pointer rests near the top or bottom edge of the list, and keep the gap in step.
  const dragging = drag !== null;
  React.useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const current = dragRef.current;
      const scroller = scrollerRef.current;
      if (current && scroller) {
        const box = scroller.getBoundingClientRect();
        const edge = 56;
        const speed =
          current.pointerY < box.top + edge
            ? -Math.ceil((box.top + edge - current.pointerY) / 4)
            : current.pointerY > box.bottom - edge
              ? Math.ceil((current.pointerY - box.bottom + edge) / 4)
              : 0;
        const before = scroller.scrollTop;
        if (speed !== 0) scroller.scrollTop += speed;
        if (scroller.scrollTop !== before) {
          const y = current.pointerY - box.top + scroller.scrollTop;
          const gap = gapAtPointer(current.layout.midpoints, y);
          if (gap !== current.gap) {
            const next = { ...current, gap };
            dragRef.current = next;
            setDragState(next);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  if (notebook.isPending) return <AsyncPlaceholder status="pending" className="h-full" />;
  if (notebook.error || !notebook.data) {
    return <AsyncPlaceholder status="error" className="h-auto" message={notebook.error?.message ?? "笔记本不存在"} />;
  }
  if (!live || !saved) return <AsyncPlaceholder status="pending" className="h-full" />;

  const savedAt = saved.updatedAt;
  const runDisabled = dirty || saving || runningTarget !== null;

  const persistThenRun = async (cellId: string | null) => {
    try {
      await session.saveThenRun(cellId);
    } catch {
      // saveError / runError render under the editor.
    }
  };

  const requestFocus = (id: string, nextMode: NotebookMode) => {
    focusSerial.current += 1;
    setFocusTick({ id, mode: nextMode, token: focusSerial.current });
  };

  const commitKey = (cellId: string, origin: NotebookMode, event: Parameters<typeof toNotebookKeyEvent>[0]) => {
    const snap = keyboardRef.current;
    const doc = session.doc() ?? live;
    const wasDirty = session.store.getState().draft !== null;
    const keyEvent = toNotebookKeyEvent(event);
    if (session.isBusy() && interpretNotebookKey(origin, keyEvent, snap.deleteArmed).command?.type === "run") {
      return true;
    }
    const result = dispatchNotebookKey(
      { cells: doc.cells, selectedId: cellId, mode: snap.mode, deleteArmed: snap.deleteArmed },
      cellId,
      origin,
      keyEvent,
      () => newNotebookCell("code"),
      false,
    );
    const nextDirty = wasDirty || result.changed;
    keyboardRef.current = { mode: result.surface.mode, deleteArmed: result.surface.deleteArmed };
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
      void persistThenRun(result.run?.cellId ?? null);
    }
    return result.handled;
  };

  /** Inserts after `position` (a cell index, -1 for the top) or after the selected cell. */
  const insertCell = (role: NotebookCellRole, position?: number) => {
    const cell = newNotebookCell(role);
    const anchor = position ?? (selected ? live.cells.findIndex((item) => item.id === selected) : live.cells.length - 1);
    const cells = [...live.cells];
    cells.splice(anchor < 0 && position === undefined ? cells.length : anchor + 1, 0, cell);
    update({ cells });
    setSelected(cell.id);
    setDeleteArmed(false);
    if (role === "markdown") setMarkdownEditId(cell.id);
    setMode("edit");
    requestFocus(cell.id, "edit");
  };
  const moveCell = (id: string, delta: -1 | 1) => {
    const from = live.cells.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= live.cells.length) return;
    const cells = [...live.cells];
    const [cell] = cells.splice(from, 1);
    if (!cell) return;
    cells.splice(to, 0, cell);
    update({ cells });
    setSelected(id);
  };
  const dropCell = () => {
    const current = dragRef.current;
    setDrag(null);
    if (!current || current.gap === null) return;
    const cells = moveCellToGap(live.cells, current.id, current.gap);
    if (!cells) return;
    update({ cells });
    setSelected(current.id);
  };
  /** Pointer Y in the scroll content, so positions measured at drag start stay valid as the list scrolls. */
  const contentY = (clientY: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return clientY;
    return clientY - scroller.getBoundingClientRect().top + scroller.scrollTop;
  };
  const startDrag = (id: string, clientY: number) => {
    const articles = Array.from(
      cellListRef.current?.querySelectorAll<HTMLElement>(":scope > [data-cell-slot] > article") ?? [],
    );
    const rects = articles.map((article) => article.getBoundingClientRect());
    const index = live.cells.findIndex((cell) => cell.id === id);
    const own = rects[index];
    if (!own) return;
    const tops = rects.map((rect) => contentY(rect.top));
    const last = rects.length - 1;
    const spacing = last > 0 ? tops[last] - tops[last - 1] - rects[last - 1].height : 20;
    const layout = {
      midpoints: rects.map((rect, i) => tops[i] + rect.height / 2),
      pitches: rects.map((rect, i) => (i < last ? tops[i + 1] - tops[i] : rect.height + spacing)),
      // Line the preview up with the editor box, past the 3rem gutter.
      left: own.left + 48,
      width: own.width - 52,
      grab: clientY - own.top,
    };
    setDrag({ id, gap: null, pointerY: clientY, layout });
  };
  /** Track the pointer while a cell is dragged: move the preview and pick the gap it points at. */
  const dragMove = (clientY: number) => {
    const current = dragRef.current;
    if (!current) return;
    setDrag({ ...current, gap: gapAtPointer(current.layout.midpoints, contentY(clientY)), pointerY: clientY });
  };
  const dragIndex = drag ? live.cells.findIndex((cell) => cell.id === drag.id) : -1;
  const offsets = drag ? dragOffsets(drag.layout.pitches, dragIndex, drag.gap) : null;

  const clearOutput = (id?: string) => session.clearOutput(id);
  const hasOutputs = Object.keys(outputs).length > 0;
  const selectedIndex = live.cells.findIndex((cell) => cell.id === selected);
  const selectedCell = live.cells.find((cell) => cell.id === selected);
  const openPublish = () => {
    const href = `/workbench/${notebookId}/publish`;
    if (dirty) {
      session.flush().then(() => router.push(href), () => {});
      return;
    }
    router.push(href);
  };
  const savedLabel = saving || dirty
      ? "保存中…"
      : `已自动保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

  return (
    <div className="flex size-full min-h-0 flex-col">
      {/* Single row: never wrap. Narrow widths hide lower-priority actions via @container. */}
      <div
        role="toolbar"
        aria-label="笔记本工具栏"
        className="@container flex h-9 min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden border-b border-border bg-glass-strong px-2"
      >
        <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 font-normal" aria-label="+ 代码" onClick={() => insertCell("code")}>
          <Plus /> <span className="hidden @[22rem]:inline">代码</span>
        </Button>
        <Button type="button" size="sm" variant="ghost" className="hidden h-7 shrink-0 gap-1 px-2 font-normal @[28rem]:inline-flex" aria-label="+ 说明" onClick={() => insertCell("markdown")}>
          <Plus /> 说明
        </Button>
        <span aria-hidden className="mx-1 hidden h-4 w-px shrink-0 bg-border @[28rem]:block" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 font-normal" aria-label="运行全部" disabled={runDisabled} onClick={() => session.runAll()}>
              {runningTarget === "all" ? <Loader2 className="animate-spin" /> : <FastForward />}
              <span className="hidden @[24rem]:inline">全部运行</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>重启内核后从第一格依次运行，遇到报错停下</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="hidden h-7 shrink-0 gap-1 px-2 font-normal @[36rem]:inline-flex"
          aria-label="清除全部输出"
          disabled={!hasOutputs}
          onClick={() => clearOutput()}
        >
          <Eraser /> <span className="hidden @[44rem]:inline">清除全部输出</span>
        </Button>
        {live.language === "python" ? (
          <>
            <span aria-hidden className="mx-1 hidden h-4 w-px shrink-0 bg-border @[32rem]:block" />
            <div className="hidden min-w-0 shrink @[32rem]:flex">
              <KernelControls
                compact
                notebookId={notebookId}
                running={runningTarget !== null}
                statusClassName="hidden @[48rem]:inline-flex"
              />
            </div>
          </>
        ) : null}
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
          <Select
            value={selectedCell?.role ?? ""}
            disabled={!selectedCell}
            onValueChange={(role) => selected && updateCell(selected, { role: role as NotebookCellRole })}
          >
            <SelectTrigger size="sm" className="hidden h-7 w-24 border-transparent bg-transparent text-xs shadow-none hover:bg-accent @[40rem]:flex" aria-label="当前单元格类型">
              <SelectValue placeholder="单元格类型" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CELL_ROLE_LABEL) as NotebookCellRole[]).map((role) => (
                <SelectItem key={role} value={role}>{CELL_ROLE_LABEL[role]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="hidden min-w-0 max-w-40 shrink @[30rem]:flex">
            <KernelPicker
              subtle
              value={live.kernel}
              onChange={(kernel) => update({ kernel, language: languageForKernel(kernel) })}
            />
          </div>
          <ExportMenu
            doc={live}
            outputs={outputs}
            ports={ports}
            onExportModule={openPublish}
          />
        </div>
      </div>

      {live.temporary && (
        <div role="status" className="flex flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">临时笔记本{live.fromModuleId ? <> · 编辑模块 <span className="font-mono">{live.fromModuleId}</span></> : null}</span>
          <Button type="button" size="sm" variant="outline" disabled={keep.isPending} onClick={() => keep.mutate(live.id, { onError: (error) => toast.error(error.message) })}>
            保存到项目
          </Button>
          <Button type="button" size="sm" onClick={openPublish}>导出为模块</Button>
        </div>
      )}

      {fromCanvas && (
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
              </>
            ) : (
              <>画布节点 <span className="font-mono">{fromCanvas.from}</span> 无可填入的值</>
            )}
            {fromCanvas.skipped.length > 0 && (
              <span className="text-muted-foreground"> · 已跳过 {fromCanvas.skipped.join("、")}</span>
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

      {lastKernel?.note ? (
        <p role="status" className="border-b border-border bg-warning/10 px-4 py-2 text-xs text-foreground">
          {lastKernel.note}
        </p>
      ) : null}

      {drag && live.cells[dragIndex] ? (
        <DragPreview
          cell={live.cells[dragIndex]}
          language={live.language === "r" ? "R" : "Python"}
          top={drag.pointerY - drag.layout.grab}
          left={drag.layout.left}
          width={drag.layout.width}
        />
      ) : null}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
        <div ref={cellListRef} className="mx-auto grid max-w-6xl px-4 pt-5 pb-24">
          <InsertBar after={-1} onInsert={insertCell} />
          {live.cells.map((cell, index) => (
            <div
              key={cell.id}
              data-cell-slot
              className={cn("relative", drag && "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out")}
              style={offsets?.[index] ? { transform: `translateY(${offsets[index]}px)` } : undefined}
            >
              <NotebookCellCard
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
                readOnly={false}
                runDisabled={runDisabled}
                canDelete={live.cells.length > 1}
                output={outputs[cell.id]}
                durationMs={durations[cell.id]}
                deleteArmed={deleteArmed}
                editFocusToken={focusTick?.id === cell.id && focusTick.mode === "edit" ? focusTick.token : 0}
                commandFocusToken={focusTick?.id === cell.id && focusTick.mode === "command" ? focusTick.token : 0}
                markdownOpen={markdownEditId === cell.id}
                canMoveUp={index > 0}
                canMoveDown={index < live.cells.length - 1}
                onMove={(delta) => moveCell(cell.id, delta)}
                onClearOutput={() => clearOutput(cell.id)}
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
                dragging={drag?.id === cell.id}
                onDragStart={(clientY) => startDrag(cell.id, clientY)}
                onDragMove={dragMove}
                onDragEnd={(commit) => (commit ? dropCell() : setDrag(null))}
                onDelete={() => {
                  const remaining = live.cells.filter((item) => item.id !== cell.id);
                  update({ cells: remaining });
                  clearOutput(cell.id);
                  if (selected === cell.id) setSelected(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
                }}
              />
              <InsertBar after={index} last={index === live.cells.length - 1} onInsert={insertCell} />
            </div>
          ))}
        </div>
      </div>

      {(saveError || runError) && <p role="alert" className="border-t border-border px-4 py-2 text-sm text-destructive">{saveError ?? runError}</p>}
      <footer className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate" title={mode === "command" ? COMMAND_HINT : EDIT_HINT}>{mode === "command" ? COMMAND_HINT : EDIT_HINT}</span>
        <span className="ml-auto shrink-0">{live.language === "python" ? "常驻内核 · 变量会保留" : "每次从头运行"}</span>
        {selectedIndex >= 0 ? <span className="shrink-0">单元格 {selectedIndex + 1} / {live.cells.length}</span> : null}
        <span className="shrink-0">{savedLabel}</span>
      </footer>
    </div>
  );
}
