import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RUN_STATUS } from "../format";
import type { RunProgress, RunSummary } from "../types";

export function StatusBadge({ status }: { status: RunSummary["status"] }) {
  const s = RUN_STATUS[status];
  return (
    <Badge variant={s.variant}>
      {(status === "submitted" || status === "running") && (
        <Loader2 className="animate-spin" />
      )}
      {s.label}
    </Badge>
  );
}

export function ProgressBar({
  progress,
  className,
}: {
  progress: RunProgress;
  className?: string;
}) {
  const pct = (n: number) =>
    progress.total ? `${(n / progress.total) * 100}%` : "0%";
  return (
    <div
      role="progressbar"
      aria-label="运行进度"
      aria-valuemin={0}
      aria-valuemax={progress.total || undefined}
      aria-valuenow={
        progress.total ? progress.completed + progress.cached : undefined
      }
      aria-valuetext={
        progress.total
          ? `完成 ${progress.completed + progress.cached} / ${progress.total}`
          : "正在发现任务"
      }
      className={cn(
        "flex h-1.5 overflow-hidden rounded-full bg-secondary",
        className,
      )}
    >
      <div
        className="bg-success transition-[width] duration-500"
        style={{ width: pct(progress.completed + progress.cached) }}
      />
      <div
        className="bg-destructive transition-[width] duration-500"
        style={{ width: pct(progress.failed) }}
      />
      <div
        className="bg-warning transition-[width] duration-500"
        style={{ width: pct(progress.aborted) }}
      />
      <div
        className="animate-pulse bg-primary transition-[width] duration-500"
        style={{ width: pct(progress.running) }}
      />
    </div>
  );
}
