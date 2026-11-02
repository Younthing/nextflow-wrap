"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { useHealthStatus } from "@/features/runs/queries";
import { cn } from "@/lib/utils";

/**
 * Nextflow and runner health in the sidebar. Collapsed, it is a coloured dot with the same text as its tooltip.
 */
export function BackendStatus({ collapsed = false }: { collapsed?: boolean }) {
  const { data, isError, isPending } = useHealthStatus();

  const state = isPending
    ? { tone: "secondary" as const, text: "连接中…" }
    : isError
      ? { tone: "destructive" as const, text: "后端不可用" }
      : data.status === "degraded"
        ? { tone: "warning" as const, text: "Runner 未就绪 · 检查环境" }
        : { tone: data.mocked ? ("warning" as const) : ("success" as const), text: `Nextflow ${data.nextflowVersion}${data.mocked ? " · 模拟" : ""}` };
  const degraded = !isPending && !isError && data.status === "degraded";

  if (collapsed) {
    const dot = (
      <span
        role="status"
        aria-label={state.text}
        title={degraded ? `${state.text}：${data.diagnostics ?? ""}` : state.text}
        className="flex h-9 w-full items-center justify-center"
      >
        <span
          className={cn(
            "size-2.5 rounded-full",
            state.tone === "success" && "bg-success",
            state.tone === "warning" && "bg-warning",
            state.tone === "destructive" && "bg-destructive",
            state.tone === "secondary" && "animate-pulse bg-muted-foreground",
          )}
        />
      </span>
    );
    return degraded ? <Link href="/setup">{dot}</Link> : dot;
  }

  if (isPending) return <Badge variant="secondary">连接中…</Badge>;
  if (isError) return <Badge variant="destructive">后端不可用</Badge>;
  if (degraded) return (
    <Link href="/setup" title={data.diagnostics}>
      <Badge variant="warning">Runner 未就绪 · 检查环境</Badge>
    </Link>
  );

  return (
    <Badge variant={data.mocked ? "warning" : "success"} className="max-w-full font-mono" title={data.mocked ? "演示模式：不运行 Nextflow" : undefined}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">Nextflow {data.nextflowVersion}</span>
      {data.mocked ? <span className="font-sans">· 模拟</span> : null}
    </Badge>
  );
}
