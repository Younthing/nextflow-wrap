"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CellOutputModel } from "@/features/notebook/outputs";
import type { NotebookCell, NotebookCellRole } from "@/features/notebook/types";
import { cn } from "@/lib/utils";
import { CellOutputView } from "./cell-output";
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
}) {
  const number = index + 1;
  const executable = cell.role !== "markdown";
  const canRun = executable && !readOnly && !runDisabled;
  const showRunning = running && executable;
  const markdown = cell.role === "markdown";
  const [markdownEditing, setMarkdownEditing] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  if ((readOnly || !selected) && markdownEditing) setMarkdownEditing(false);
  const showPreview = markdown && !markdownEditing && (readOnly || cell.source.trim().length > 0);

  useEffect(() => {
    if (markdown && markdownEditing) sourceRef.current?.focus();
  }, [markdown, markdownEditing]);

  return (
    <article
      aria-label={`单元格 ${number}`}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
      className={cn(
        "relative overflow-hidden rounded-lg border transition-colors",
        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
      )}
      onClick={onSelect}
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
                运行此单元格
                <span className="ml-2 font-mono text-muted-foreground">Shift+Enter</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="size-8" />
          )}
          <span className="font-mono text-[10px] leading-none text-muted-foreground">{showRunning ? "[*]" : `[${number}]`}</span>
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
                  setMarkdownEditing(showPreview);
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
              onClick={(event) => {
                if (readOnly) return;
                const target = event.target;
                if (target instanceof Element && target.closest("a, button, input")) return;
                onSelect();
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
          ) : (
            <Textarea
              ref={sourceRef}
              value={cell.source}
              disabled={readOnly}
              spellCheck={false}
              aria-label={`单元格 ${number} 源码`}
              onFocus={onSelect}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
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
              }}
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
