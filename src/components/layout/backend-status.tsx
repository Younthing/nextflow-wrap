"use client";


import { Badge } from "@/components/ui/badge";
import { useHealthStatus } from "@/features/runs/queries";

export function BackendStatus() {
  const { data, isError, isPending } = useHealthStatus();

  if (isPending) return <Badge variant="secondary">连接中…</Badge>;
  if (isError) return <Badge variant="destructive">后端不可用</Badge>;
  if (data.status === "degraded") return <Badge variant="warning" title={data.diagnostics}>Runner 未就绪</Badge>;

  return (
    <Badge variant={data.mocked ? "warning" : "success"}>
      <span className="size-1.5 rounded-full bg-current" />
      Nextflow {data.nextflowVersion}
      {data.mocked && " · 模拟"}
    </Badge>
  );
}
