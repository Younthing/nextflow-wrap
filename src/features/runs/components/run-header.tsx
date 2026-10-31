"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  PencilRuler,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENGINE_LABELS, executorDef } from "@/features/project/launch";
import { formatDuration, formatTime, runDuration } from "../format";
import { isActive, useCancelRun, useDeleteRun, useResumeRun } from "../queries";
import type { RunDetail } from "../types";
import { ProgressBar, StatusBadge } from "./run-status";

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/** Re-renders every second while the run is active, so the duration ticks. */
function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function RunHeader({ run }: { run: RunDetail }) {
  const router = useRouter();
  const cancel = useCancelRun();
  const del = useDeleteRun();
  const resume = useResumeRun();
  const active = isActive(run.status);
  const now = useNow(active);
  const p = run.progress;

  return (
    <header className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label="返回运行记录"
        >
          <Link href="/runs">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-mono text-xl font-semibold">{run.runName}</h1>
        <StatusBadge status={run.status} />
        <span className="text-sm text-muted-foreground">
          {run.workflowName}
        </span>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/workflows/${run.workflowId}`}>
              <PencilRuler /> 在编辑器中打开
            </Link>
          </Button>
          {!active && run.nextflowSessionId && (
            <Button
              variant="outline"
              size="sm"
              disabled={resume.isPending}
              onClick={() =>
                resume.mutate(run.id, {
                  onSuccess: (next) => router.push(`/runs/${next.id}`),
                })
              }
            >
              从此运行恢复
            </Button>
          )}
          {active ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={cancel.isPending || run.phase === "cancelling"}
              onClick={() => cancel.mutate(run.id)}
            >
              {cancel.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Square />
              )}{" "}
              停止
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(run.id, { onSuccess: () => router.push("/runs") })
              }
            >
              <Trash2 /> 删除
            </Button>
          )}
        </div>
      </div>

      {run.phase && (
        <p className="text-xs text-muted-foreground">
          {
            {
              queued: "等待 runner 领取",
              preparing: "正在准备项目和安装依赖",
              executing: "执行中 · 任务数量随流程展开更新",
              finalizing: "正在核对任务与结果",
              cancelling: "正在停止计算并清理任务",
            }[run.phase]
          }
        </p>
      )}
      {(cancel.error || del.error || resume.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(cancel.error || del.error || resume.error)?.message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="运行环境">{executorDef(run.executor).name}</Stat>
        <Stat label="软件环境">
          {ENGINE_LABELS[run.launch.engine]}
          {run.launch.extraProfiles.length > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              {" "}
              +{run.launch.extraProfiles.join(",")}
            </span>
          )}
        </Stat>
        <Stat label="提交时间">{formatTime(run.submittedAt)}</Stat>
        <Stat label="耗时">
          <span className="font-mono">
            {formatDuration(runDuration(run, now))}
          </span>
        </Stat>
        <Stat label="工作目录">
          <span className="font-mono text-xs break-all">
            {run.launch.workDir}
          </span>
        </Stat>
        <Stat label="任务">
          <span className="font-mono">
            已发现 {p.total} · 完成 {p.completed + p.cached}
            {p.running > 0 && (
              <span className="text-primary"> · {p.running} 运行中</span>
            )}
            {p.failed > 0 && (
              <span className="text-destructive"> · {p.failed} 失败</span>
            )}
            {p.aborted > 0 && (
              <span className="text-warning"> · {p.aborted} 中止</span>
            )}
          </span>
        </Stat>
      </div>
      <ProgressBar progress={p} className="h-2" />

      {run.errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="font-mono text-xs leading-5">
            {run.errorMessage}
          </span>
        </div>
      )}
    </header>
  );
}
