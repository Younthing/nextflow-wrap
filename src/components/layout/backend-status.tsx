"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { HealthStatus } from "@/lib/api-types";

export function BackendStatus() {
  const { data, isError, isPending } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<HealthStatus>("/health"),
    refetchInterval: 60_000,
  });

  if (isPending) return <Badge variant="secondary">连接中…</Badge>;
  if (isError) return <Badge variant="destructive">后端不可用</Badge>;

  return (
    <Badge variant={data.mocked ? "warning" : "success"}>
      <span className="size-1.5 rounded-full bg-current" />
      Nextflow {data.nextflowVersion}
      {data.mocked && " · 模拟"}
    </Badge>
  );
}
