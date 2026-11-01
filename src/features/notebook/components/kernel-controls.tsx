"use client";

import { Loader2, RotateCcw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
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
}: {
  notebookId: string;
  /** A run request is in flight from this editor. */
  running: boolean;
  disabled?: boolean;
}) {
  const info = useKernelInfo(notebookId, !disabled);
  const action = useKernelAction();
  const state: KernelState = info.data?.state ?? "stopped";
  const busy = running || state === "busy";
  const shown = running && state !== "starting" ? "busy" : state;
  const title = [info.data?.kernel ? `Jupyter 内核 ${info.data.kernel}` : "", info.data?.python ?? "", info.data?.note ?? ""]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex items-center gap-1" role="group" aria-label="内核控制">
      <span className="inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground" role="status" title={title || undefined}>
        <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[shown])} aria-hidden />
        {STATE_TEXT[shown]}
      </span>
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
        {action.isPending && action.variables?.action === "restart" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        重启内核
      </Button>
      {action.error ? (
        <span role="alert" className="max-w-56 truncate text-xs text-destructive" title={action.error.message}>
          {action.error.message}
        </span>
      ) : null}
    </div>
  );
}
