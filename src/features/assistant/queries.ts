"use client";

import { useQuery } from "@tanstack/react-query";
import type { AssistantStatus } from "./assistant-provider";
import { STATUS_TIMEOUT_REASON, type CliBlocker } from "./backend";

/** The `/api/copilotkit/status` body: the server's `AssistantChoice`. */
interface StatusBody {
  enabled: boolean;
  message?: string;
  backend?: string;
  model?: string;
  reason?: string;
  missing?: string;
  codex?: CliBlocker;
  grok?: CliBlocker;
}

/** Turn the status body into what the header button and the settings page show. */
export function parseAssistantStatus(body: StatusBody): AssistantStatus {
  const facts = {
    ...(body.backend ? { backend: body.backend } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.reason ? { reason: body.reason } : {}),
    ...(body.missing ? { missing: body.missing } : {}),
    ...(body.codex ? { codex: body.codex } : {}),
    ...(body.grok ? { grok: body.grok } : {}),
  };
  if (!body.enabled)
    return { enabled: false, message: body.message ?? "AI 助手未启用", ...facts };
  const detail =
    body.backend === "codex"
      ? body.model
        ? `本机 Codex（${body.model}）`
        : "本机 Codex"
      : body.backend === "grok"
        ? body.model
          ? `本机 Grok Build（${body.model}）`
          : "本机 Grok Build"
        : (body.model ?? "API");
  return { enabled: true, detail, ...facts };
}

async function fetchStatus(): Promise<AssistantStatus> {
  try {
    const res = await fetch("/api/copilotkit/status");
    if (!res.ok)
      return { enabled: false, message: `AI 助手不可用（${res.status}）` };
    return parseAssistantStatus((await res.json()) as StatusBody);
  } catch {
    return { enabled: false, message: "AI 助手不可用：连不上服务端" };
  }
}

/** How soon to ask again after the server gave up waiting for the CLI probes, which keep running there. */
const STATUS_RETRY_MS = 4_000;

export function useAssistantStatusQuery() {
  return useQuery({
    queryKey: ["assistant", "status"],
    queryFn: fetchStatus,
    staleTime: Infinity,
    refetchInterval: (query) => (query.state.data?.reason === STATUS_TIMEOUT_REASON ? STATUS_RETRY_MS : false),
  });
}
