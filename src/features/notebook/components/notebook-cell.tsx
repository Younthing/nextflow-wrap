"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Eraser, Loader2, Pencil, Play, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { segmentsOf, type CellOutputModel } from "@/features/notebook/outputs";
import type { NotebookCell, NotebookCellRole, NotebookLanguage } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { CellOutputView } from "./cell-output";
import { CellSourceEditor } from "./cell-source-editor";
import { MarkdownView } from "./markdown-view";

export const CELL_ROLE_LABEL: Record<NotebookCellRole, string> = {
  code: "代码",
  markdown: "说明",
  input: "输入",
  output: "输出",
  explore: "自由探索",
};

const LANGUAGE_LABEL: Record<NotebookLanguage, string> = {
  python: "Python",
  r: "R",
};

function failed(output: CellOutputModel): boolean {
  if (output.error) return true;
  return segmentsOf(output).some((segment) => segment.outputType === "error");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function ToolbarButton({
  label,
  hint,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          className={cn("size-7 rounded-sm text-muted-foreground hover:text-foreground", danger && "hover:text-destructive")}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * One notebook cell laid out like VS Code's Jupyter editor: a gutter with the
 * run button and execution count, a bordered editor with its language in the
 * corner, a floating toolbar on hover or selection, and outputs underneath.
 */
export function NotebookCellCard({
  cell,
  index,
  selected,
  running,
  readOnly,
  runDisabled,
  canDelete,
  output,
  durationMs,
  onSelect,
  onRun,
  onChange,
  onRole,
  onDelete,
  onMove,
  onClearOutput,
  canMoveUp = false,
  canMoveDown = false,
  language,
  completionScope = "",
  deleteArmed = false,
  editFocusToken = 0,
  commandFocusToken = 0,
  markdownOpen = false,
  onEditKey,
  onCommandKey,
  onEnterEdit,
  onEnterCommand,
}: {
  cell: NotebookCell;
  index: number;
  selected: boolean;
  running: boolean;
  readOnly: boolean;
  runDisabled: boolean;
  canDelete: boolean;
  output?: CellOutputModel;
  /** Wall time of the last single-cell run, shown next to the status mark. */
  durationMs?: number;
  onSelect: () => void;
  onRun: (intent: { advance: boolean }) => void;
  onChange: (source: string) => void;
  onRole: (role: NotebookCellRole) => void;
  onDelete: () => void;
  onMove?: (delta: -1 | 1) => void;
  onClearOutput?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  language?: NotebookLanguage;
  completionScope?: string;
  deleteArmed?: boolean;
  editFocusToken?: number;
  commandFocusToken?: number;
  /** Keyboard Enter asked this markdown cell to open its editor. */
  markdownOpen?: boolean;
  onEditKey?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  onCommandKey?: (event: KeyboardEvent<HTMLButtonElement>) => boolean;
  onEnterEdit?: () => void;
  onEnterCommand?: () => void;
}) {
  const number = index + 1;
  const executable = cell.role !== "markdown";
  const canRun = executable && !readOnly && !runDisabled;
  const showRunning = running && executable;
  const markdown = cell.role === "markdown";
  const [markdownEditing, setMarkdownEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toolbarMenu, setToolbarMenu] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const commandRef = useRef<HTMLButtonElement>(null);
  if ((readOnly || !selected) && markdownEditing) setMarkdownEditing(false);
  const showEditor = markdown && !readOnly && (markdownEditing || markdownOpen);
  const showPreview = markdown && !showEditor && (readOnly || cell.source.trim().length > 0);
  const highlighted = !markdown && language !== undefined;
  const shownOutput = executable && output ? output : undefined;
  const status = shownOutput && !showRunning ? (failed(shownOutput) ? "error" : "ok") : null;
  const languageLabel = markdown ? "Markdown" : language ? LANGUAGE_LABEL[language] : "";
  const raised = menu || toolbarMenu;

  useEffect(() => {
    if (markdown && markdownEditing) sourceRef.current?.focus();
  }, [markdown, markdownEditing]);

  useEffect(() => {
    if (!editFocusToken) return;
    sourceRef.current?.focus();
  }, [editFocusToken]);

  useEffect(() => {
    if (!commandFocusToken) return;
    commandRef.current?.focus();
  }, [commandFocusToken]);

  const openMarkdown = () => {
    if (readOnly) return;
    onSelect();
    onEnterEdit?.();
    setMarkdownEditing(true);
  };

  const handleSourceKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onEditKey?.(event)) {
      event.preventDefault();
      if (markdown && (event.key === "Escape" || event.key === "Enter")) setMarkdownEditing(false);
      return;
    }
    if (onEditKey) return;
    if (markdown && event.key === "Escape") {
      event.preventDefault();
      if (cell.source.trim().length > 0) setMarkdownEditing(false);
      return;
    }
    if (event.nativeEvent.isComposing || event.key !== "Enter" || !canRun) return;
    const stay = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
    const advance = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!stay && !advance) return;
    event.preventDefault();
    onRun({ advance });
  };

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (onCommandKey?.(event)) event.preventDefault();
  };

  const roleChip = cell.role !== "code" && cell.role !== "markdown";

  return (
    <article
      aria-label={`单元格 ${number}`}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
      className={cn("group/cell relative flex", raised && "z-20")}
      onClick={(event) => {
        onSelect();
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("textarea, input, button, a, select, [role=listbox], [data-markdown-preview]")) return;
        onEnterCommand?.();
      }}
    >
      {/* Selection bar: VS Code marks the focused cell with a strip on the left edge. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 rounded-full transition-colors",
          selected ? "bg-primary" : "bg-transparent group-hover/cell:bg-border",
        )}
      />

      <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 pt-1">
        {executable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={showRunning ? `正在运行单元格 ${number}` : `运行单元格 ${number}`}
                disabled={!canRun}
                className={cn(
                  "size-7 rounded-sm transition-opacity",
                  !selected && !showRunning && "opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                  onRun({ advance: false });
                }}
              >
                {showRunning ? <Loader2 className="animate-spin" /> : <Play />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              运行单元格
              <span className="ml-2 font-mono text-muted-foreground">Ctrl+Enter</span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="size-7" />
        )}
        <button
          ref={commandRef}
          type="button"
          tabIndex={-1}
          aria-label={`单元格 ${number} 命令模式`}
          className={cn(
            "rounded-sm font-mono text-[10px] leading-none text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            !executable && "sr-only",
            deleteArmed && selected && "text-destructive",
          )}
          onMouseDown={() => {
            onSelect();
            onEnterCommand?.();
          }}
          onKeyDown={handleCommandKeyDown}
        >
          {/* A persistent kernel numbers executions the way Jupyter does; blank until the cell runs. */}
          {showRunning ? "[*]" : shownOutput?.executionCount !== undefined ? `[${shownOutput.executionCount}]` : "[ ]"}
        </button>
      </div>

      <div className="relative min-w-0 flex-1 pr-1">
        {!readOnly ? (
          <div
            role="toolbar"
            aria-label={`单元格 ${number} 操作`}
            className={cn(
              "glass-strong absolute -top-4 right-3 z-10 flex items-center gap-0.5 rounded-md p-0.5 transition-opacity",
              selected || toolbarMenu
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover/cell:pointer-events-auto group-hover/cell:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
            )}
          >
            {markdown && cell.source.trim().length > 0 ? (
              showPreview ? (
                <ToolbarButton label={`编辑单元格 ${number}`} hint="编辑（双击说明也可以）" onClick={openMarkdown}>
                  <Pencil />
                </ToolbarButton>
              ) : (
                <ToolbarButton
                  label={`预览单元格 ${number}`}
                  hint="完成编辑并预览"
                  onClick={() => {
                    onSelect();
                    setMarkdownEditing(false);
                    onEnterCommand?.();
                  }}
                >
                  <Check />
                </ToolbarButton>
              )
            ) : null}
            <Select
              value={cell.role}
              onValueChange={(role) => onRole(role as NotebookCellRole)}
              onOpenChange={setToolbarMenu}
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-auto gap-1 border-transparent bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                aria-label={`单元格 ${number} 类型`}
                onFocus={onSelect}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CELL_ROLE_LABEL) as NotebookCellRole[]).map((role) => (
                  <SelectItem key={role} value={role}>{CELL_ROLE_LABEL[role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {onMove ? (
              <>
                <ToolbarButton label={`上移单元格 ${number}`} disabled={!canMoveUp} onClick={() => onMove(-1)}>
                  <ArrowUp />
                </ToolbarButton>
                <ToolbarButton label={`下移单元格 ${number}`} disabled={!canMoveDown} onClick={() => onMove(1)}>
                  <ArrowDown />
                </ToolbarButton>
              </>
            ) : null}
            {onClearOutput && shownOutput ? (
              <ToolbarButton label={`清除单元格 ${number} 输出`} onClick={onClearOutput}>
                <Eraser />
              </ToolbarButton>
            ) : null}
            <ToolbarButton
              label={`删除单元格 ${number}`}
              hint="删除单元格（命令模式下按两次 D）"
              danger
              disabled={!canDelete}
              onClick={onDelete}
            >
              <Trash2 />
            </ToolbarButton>
          </div>
        ) : null}

        {showPreview ? (
          <section
            aria-label={`单元格 ${number} 说明预览`}
            className={cn("min-h-10 rounded-md px-3 py-2", !readOnly && "cursor-default")}
            data-markdown-preview
            title={readOnly ? undefined : "双击编辑"}
            onClick={() => onSelect()}
            onDoubleClick={(event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("a, button, input")) return;
              event.stopPropagation();
              openMarkdown();
            }}
            onKeyDown={(event) => {
              if (readOnly || event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setMarkdownEditing(true);
            }}
            tabIndex={readOnly ? undefined : 0}
          >
            {cell.source.trim() ? (
              <MarkdownView source={cell.source} />
            ) : (
              <p className="text-sm text-muted-foreground">空的说明。</p>
            )}
          </section>
        ) : (
          <div
            className={cn(
              "relative rounded-md border bg-muted/30 transition-colors",
              selected ? "border-border" : "border-border/70",
              "focus-within:border-primary/60",
            )}
          >
            {highlighted && language ? (
              <CellSourceEditor
                cellId={cell.id}
                value={cell.source}
                language={language}
                scope={completionScope}
                disabled={readOnly}
                label={`单元格 ${number} 源码`}
                inputRef={sourceRef}
                onChange={onChange}
                onKeyDown={handleSourceKeyDown}
                onFocus={() => {
                  onSelect();
                  onEnterEdit?.();
                }}
                onMenu={setMenu}
              />
            ) : (
              <Textarea
                ref={sourceRef}
                value={cell.source}
                disabled={readOnly}
                spellCheck={false}
                placeholder={markdown ? "用 Markdown 写说明…" : undefined}
                aria-label={`单元格 ${number} 源码`}
                onFocus={() => {
                  onSelect();
                  if (!markdown) onEnterEdit?.();
                }}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleSourceKeyDown}
                className={cn(
                  "min-h-16 rounded-md border-0 bg-transparent shadow-none focus-visible:ring-0",
                  markdown ? "text-sm" : "font-mono text-xs",
                )}
              />
            )}
            <div className="pointer-events-none flex h-5 items-center gap-2 px-2.5 pb-1 text-[11px] text-muted-foreground">
              {roleChip ? <span className="rounded-sm bg-primary/10 px-1.5 text-primary">{CELL_ROLE_LABEL[cell.role]}</span> : null}
              {deleteArmed && selected ? <span role="status" className="text-destructive">再按 D 删除</span> : null}
              <span className="ml-auto">{languageLabel}</span>
            </div>
          </div>
        )}

        {shownOutput ? (
          <div className="relative mt-1">
            <div className="absolute top-2 -left-12 flex w-12 flex-col items-center gap-0.5 text-[10px] leading-none text-muted-foreground">
              {status === "ok" ? (
                <Check className="size-3.5 text-success" aria-label="运行成功" />
              ) : status === "error" ? (
                <X className="size-3.5 text-destructive" aria-label="运行出错" />
              ) : null}
              {status && durationMs !== undefined ? <span className="font-mono">{formatDuration(durationMs)}</span> : null}
            </div>
            <CellOutputView output={shownOutput} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
