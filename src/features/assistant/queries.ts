"use client";

import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { HealthStatus } from "@/lib/api-types";
import { indexModules, type ModuleIndex } from "@/features/workflow/catalog";
import { moduleCatalogQueryOptions } from "@/features/workflow/queries";
import { healthQueryOptions } from "@/features/runs/queries";
import type { AssistantStatus } from "./assistant-provider";

async function fetchStatus(): Promise<AssistantStatus> {
  try {
    const res = await fetch("/api/copilotkit/status");
    if (!res.ok)
      return { enabled: false, message: `AI 助手不可用（${res.status}）` };
    const body = (await res.json()) as {
      enabled: boolean;
      message?: string;
      backend?: string;
      model?: string;
    };
    if (!body.enabled)
      return { enabled: false, message: body.message ?? "AI 助手未启用" };
    const detail =
      body.backend === "codex"
        ? body.model
          ? `本机 Codex（${body.model}）`
          : "本机 Codex"
        : (body.model ?? "API");
    return { enabled: true, detail };
  } catch {
    return { enabled: false, message: "AI 助手不可用：连不上服务端" };
  }
}

export function useAssistantStatusQuery() {
  return useQuery({
    queryKey: ["assistant", "status"],
    queryFn: fetchStatus,
    staleTime: Infinity,
  });
}

export async function loadHealth(
  qc: QueryClient,
): Promise<HealthStatus | undefined> {
  try {
    return await qc.fetchQuery(healthQueryOptions());
  } catch {
    return undefined;
  }
}

export async function loadCatalog(
  qc: QueryClient,
  stored: ModuleIndex,
): Promise<{ index: ModuleIndex; error?: string }> {
  const options = moduleCatalogQueryOptions();
  const cached = qc.getQueryData(options.queryKey);
  // The editor indexes the published modules once they load; before that it only knows the builtins.
  if (stored.size && cached) return { index: stored };
  try {
    const raw = cached ?? (await qc.fetchQuery(options));
    return { index: indexModules(raw.modules) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { index: new Map(), error: `模块库加载失败：${message}` };
  }
}
