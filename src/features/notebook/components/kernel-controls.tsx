"use client";

import { Loader2, RotateCcw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useKernelAction, useKernelInfo } from "@/features/notebook/queries";
import type { KernelState } from "@/features/notebook/types";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<KernelState, string> = {
  stopped: "内核未启动",
  starting: "内核启动中",
  idle: "内核空闲",
  busy: "内核运行中",
  dead: "内核已退出",
};

const STATE_DOT: Record<KernelState, string> = {
  stopped: "bg-muted-foreground/50",
  starting: "bg-warning",
  idle: "bg-success",
  busy: "bg-warning",
  dead: "bg-destructive",
};

/** State, interrupt and restart for a notebook's persistent Jupyter kernel. */
export function KernelControls({
  notebookId,
  running,
  disabled,
  compact = false,
}: {
  notebookId: string;
  /** A run request is in flight from this editor. */
  running: boolean;
  disabled?: boolean;
  /** Icon buttons with tooltips, for the workbench toolbar. The state text stays readable. */
  compact?: boolean;
}) {
  const info = useKernelInfo(notebookId, !disabled);
  const action = useKernelAction();
  const state: KernelState = info.data?.state ?? "stopped";
  const busy = running || state === "busy";
  const shown = running && state !== "starting" ? "busy" : state;
  const title = [info.data?.kernel ? `Jupyter 内核 ${info.data.kernel}` : "", info.data?.python ?? "", info.data?.note ?? ""]
    .filter(Boolean)
    .join("\n");

  const restarting = action.isPending && action.variables?.action === "restart";
  const status = (
    <span className="inline-flex items-center gap-1.5 px-1 text-xs whitespace-nowrap text-muted-foreground" role="status" title={title || undefined}>
      <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[shown])} aria-hidden />
      {STATE_TEXT[shown]}
    </span>
  );
  const error = action.error ? (
    <span role="alert" className="max-w-56 truncate text-xs text-destructive" title={action.error.message}>
      {action.error.message}
    </span>
  ) : null;

  if (compact) {
    return (
      <div className="flex items-center gap-0.5" role="group" aria-label="内核控制">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="中断" disabled={disabled || !busy || action.isPending} onClick={() => action.mutate({ id: notebookId, action: "interrupt" })}>
              <Square />
            </Button>
          </TooltipTrigger>
          <TooltipContent>中断正在运行的单元格</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="重启内核" disabled={disabled || action.isPending} onClick={() => action.mutate({ id: notebookId, action: "restart" })}>
              {restarting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>重启内核，清空变量</TooltipContent>
        </Tooltip>
        {status}
        {error}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="内核控制">
      {status}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || !busy || action.isPending}
        onClick={() => action.mutate({ id: notebookId, action: "interrupt" })}
      >
        <Square />
        中断
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || action.isPending}
        onClick={() => action.mutate({ id: notebookId, action: "restart" })}
      >
        {restarting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        重启内核
      </Button>
      {error}
    </div>
  );
}
