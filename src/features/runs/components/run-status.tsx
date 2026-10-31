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

const COUNT_TONE = {
  running: "text-primary",
  failed: "text-destructive",
  aborted: "text-warning",
} as const;

function ProgressCount({
  count,
  label,
  tone,
  kind,
}: {
  count: number;
  label: string;
  tone: "inherit" | "status";
  kind: keyof typeof COUNT_TONE;
}) {
  if (count <= 0) return null;
  const text = ` · ${count} ${label}`;
  if (tone === "inherit") return text;
  return <span className={COUNT_TONE[kind]}>{text}</span>;
}

export function ProgressSummary({
  progress,
  showRunning = false,
  tone = "inherit",
}: {
  progress: RunProgress;
  showRunning?: boolean;
  tone?: "inherit" | "status";
}) {
  return (
    <>
      {`已发现 ${progress.total} · 完成 ${progress.completed + progress.cached}`}
      {showRunning && (
        <ProgressCount
          count={progress.running}
          label="运行中"
          tone={tone}
          kind="running"
        />
      )}
      <ProgressCount count={progress.failed} label="失败" tone={tone} kind="failed" />
      <ProgressCount
        count={progress.aborted}
        label="中止"
        tone={tone}
        kind="aborted"
      />
    </>
  );
}
