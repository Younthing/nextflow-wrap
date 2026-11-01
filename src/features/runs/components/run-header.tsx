"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  PencilRuler,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ENGINE_LABELS, executorDef } from "@/features/project/launch";
import { formatDuration, formatTime, localTimeZoneLabel, runDuration } from "../format";
import { isActive, useCancelRun, useDeleteRun, useHealthStatus, useResumeRun } from "../queries";
import type { RunDetail } from "../types";
import { ProgressBar, ProgressSummary, StatusBadge } from "./run-status";
import { StopRunButton } from "./stop-run-button";

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
  const health = useHealthStatus();
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
          {!active && run.nextflowSessionId && run.workCleanedAt && (
            <span className="self-center text-xs text-muted-foreground" title={`work 目录在 ${run.workCleanedAt} 清理`}>
              work 已清理，不能续跑
            </span>
          )}
          {!active && run.nextflowSessionId && !run.workCleanedAt && (
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
            <StopRunButton
              runName={run.runName}
              pending={cancel.isPending}
              disabled={run.phase === "cancelling"}
              onStop={() => cancel.mutate(run.id)}
            />
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
        <Stat label="运行环境">
          <span className="flex items-center gap-1.5">
            {executorDef(run.executor).name}
            {health.data?.mocked && <Badge variant="warning">预览</Badge>}
          </span>
        </Stat>
        <Stat label="软件环境">
          {ENGINE_LABELS[run.launch.engine]}
          {run.launch.extraProfiles.length > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              {" "}
              +{run.launch.extraProfiles.join(",")}
            </span>
          )}
        </Stat>
        <Stat label="提交时间">
          <span className="font-mono text-xs">{formatTime(run.submittedAt)}</span>
          <span className="ml-1 text-[10px] text-muted-foreground">{localTimeZoneLabel()}</span>
        </Stat>
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
            <ProgressSummary progress={p} showRunning tone="status" />
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
