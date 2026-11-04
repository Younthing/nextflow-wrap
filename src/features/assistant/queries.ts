"use client";

import { useQuery } from "@tanstack/react-query";
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
