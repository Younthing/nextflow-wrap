"use client";

import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { HealthStatus } from "@/lib/api-types";
import { indexModules, type ModuleIndex } from "@/features/workflow/catalog";
import type { ModuleCatalog } from "@/features/workflow/types";
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
): Promise<{ index: ModuleIndex; gitSha: string; error?: string }> {
  const cached = qc.getQueryData<ModuleCatalog>(["modules"]);
  if (stored.size && cached?.gitSha)
    return { index: stored, gitSha: cached.gitSha };
  try {
    const raw = cached ?? (await qc.fetchQuery(moduleCatalogQueryOptions()));
    if (!raw) return { index: new Map(), gitSha: "", error: "模块库加载失败" };
    return {
      index: stored.size ? stored : indexModules(raw.modules),
      gitSha: raw.gitSha,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      index: new Map(),
      gitSha: "",
      error: `模块库加载失败：${message}`,
    };
  }
}
