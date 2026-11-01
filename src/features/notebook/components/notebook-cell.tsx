"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CellOutputModel } from "@/features/notebook/outputs";
import type { NotebookCell, NotebookCellRole, NotebookLanguage } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { CellOutputView } from "./cell-output";
import { CellSourceEditor } from "./cell-source-editor";
import { MarkdownView } from "./markdown-view";

const ROLE_LABEL: Record<NotebookCellRole, string> = {
  code: "代码",
  markdown: "说明",
  input: "输入",
  output: "输出",
  explore: "自由探索",
};

export function NotebookCellCard({
  cell,
  index,
  selected,
  running,
  readOnly,
  runDisabled,
  canDelete,
  output,
  onSelect,
  onRun,
  onChange,
  onRole,
  onDelete,
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
  onSelect: () => void;
  onRun: (intent: { advance: boolean }) => void;
  onChange: (source: string) => void;
  onRole: (role: NotebookCellRole) => void;
  onDelete: () => void;
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
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const commandRef = useRef<HTMLButtonElement>(null);
  if ((readOnly || !selected) && markdownEditing) setMarkdownEditing(false);
  const showEditor = markdown && !readOnly && (markdownEditing || markdownOpen);
  const showPreview = markdown && !showEditor && (readOnly || cell.source.trim().length > 0);
  const highlighted = !markdown && language !== undefined;

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

  return (
    <article
      aria-label={`单元格 ${number}`}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
      className={cn(
        "relative rounded-lg border transition-colors",
        menu ? "z-20 overflow-visible" : "overflow-hidden",
        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
      )}
      onClick={(event) => {
        onSelect();
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("textarea, input, button, a, select, [data-markdown-preview]")) return;
        onEnterCommand?.();
      }}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", selected ? "bg-primary" : "bg-transparent")} />
      <div className="flex pl-1.5">
        <div className="flex w-11 shrink-0 flex-col items-center gap-1 py-2">
          {executable ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={showRunning ? `正在运行单元格 ${number}` : `运行单元格 ${number}`}
                  disabled={!canRun}
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
                运行此单元格并留在原地
                <span className="ml-2 font-mono text-muted-foreground">Ctrl+Enter</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="size-8" />
          )}
          <button
            ref={commandRef}
            type="button"
            tabIndex={-1}
            aria-label={`单元格 ${number} 命令模式`}
            className={cn(
              "rounded-sm font-mono text-[10px] leading-none text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              deleteArmed && selected && "text-destructive",
            )}
            onMouseDown={() => {
              onSelect();
              onEnterCommand?.();
            }}
            onKeyDown={handleCommandKeyDown}
          >
            {/* A persistent kernel numbers executions the way Jupyter does; otherwise show the position. */}
            {showRunning ? "[*]" : `[${executable && output?.executionCount !== undefined ? output.executionCount : number}]`}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 py-1.5 pr-2 text-xs text-muted-foreground">
            <Badge variant="outline">{ROLE_LABEL[cell.role]}</Badge>
            <Select value={cell.role} disabled={readOnly} onValueChange={(role) => onRole(role as NotebookCellRole)}>
              <SelectTrigger
                size="sm"
                className="h-7 w-28 text-xs"
                aria-label={`单元格 ${number} 类型`}
                onFocus={onSelect}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABEL) as NotebookCellRole[]).map((role) => (
                  <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {deleteArmed && selected && <span role="status" className="text-destructive">再按 D 删除</span>}
            {markdown && !readOnly && cell.source.trim().length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                aria-label={showPreview ? `编辑单元格 ${number}` : `预览单元格 ${number}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                  if (showPreview) {
                    onEnterEdit?.();
                    setMarkdownEditing(true);
                    return;
                  }
                  setMarkdownEditing(false);
                  onEnterCommand?.();
                }}
              >
                {showPreview ? "编辑" : "预览"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={markdown && !readOnly && cell.source.trim().length > 0 ? undefined : "ml-auto"}
              disabled={readOnly || !canDelete}
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              删除
            </Button>
          </div>
          {showPreview ? (
            <section
              aria-label={`单元格 ${number} 说明预览`}
              className="min-h-28 cursor-text px-3 py-2"
              data-markdown-preview
              onClick={(event) => {
                if (readOnly) return;
                const target = event.target;
                if (target instanceof Element && target.closest("a, button, input")) return;
                event.stopPropagation();
                onSelect();
                onEnterEdit?.();
                setMarkdownEditing(true);
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
                <p className="text-sm text-muted-foreground">空的说明。点击编辑。</p>
              )}
            </section>
          ) : highlighted && language ? (
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
              aria-label={`单元格 ${number} 源码`}
              onFocus={() => {
                onSelect();
                if (!markdown) onEnterEdit?.();
              }}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleSourceKeyDown}
              className={cn(
                "min-h-28 rounded-none border-0 bg-transparent shadow-none",
                markdown ? "text-sm" : "font-mono text-xs",
              )}
            />
          )}
          {executable && output && <CellOutputView output={output} />}
        </div>
      </div>
    </article>
  );
}
