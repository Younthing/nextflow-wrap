import type { AssistantStatus } from "@/features/assistant/assistant-provider";
import type { CliBlocker } from "@/features/assistant/backend";

export type CliState = "ready" | CliBlocker | "unchecked";
export type AssistantCli = "codex" | "grok";

/**
 * What the status says about one local CLI. The server only probes a CLI it needs
 * (e.g. `auto` stops at a ready Codex), so the other one can be "unchecked".
 */
export function cliState(status: AssistantStatus, cli: AssistantCli): CliState {
  if (status.enabled && status.backend === cli) return "ready";
  if (status[cli]) return status[cli];
  const prefix = `${cli}-`;
  if (status.reason?.startsWith(prefix)) {
    const blocker = status.reason.slice(prefix.length);
    if (blocker === "not-installed" || blocker === "unauthenticated" || blocker === "unavailable") return blocker;
  }
  return "unchecked";
}

export const CLI_STATE_LABEL: Record<CliState, string> = {
  ready: "已登录",
  unauthenticated: "未登录",
  "not-installed": "未安装",
  unavailable: "无法确认",
  unchecked: "未检测",
};

/** Name of the backend the status reports as in use. */
export function backendLabel(backend: string | undefined): string {
  if (backend === "codex") return "本机 Codex";
  if (backend === "grok") return "本机 Grok Build";
  if (backend === "builtin") return "API key";
  return "自动";
}
