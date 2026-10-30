import type { ProbeResult } from "@/features/codex-harness";

/** Default BuiltInAgent model. Codex does not use this id. */
export const DEFAULT_COPILOT_MODEL = "anthropic/claude-sonnet-5-5";

const KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

export type BackendMode = "auto" | "codex" | "builtin";

export type EnvLike = Record<string, string | undefined>;

export type AssistantChoice =
  | {
      enabled: true;
      backend: "codex";
      /** Set only when `CODEX_MODEL` is set. Otherwise Codex uses its own default. */
      model?: string;
    }
  | {
      enabled: true;
      backend: "builtin";
      model: string;
      /** Why Codex was not selected, when `COPILOT_BACKEND=auto` fell back. */
      codex?: "not-installed" | "unauthenticated" | "unavailable";
    }
  | {
      enabled: false;
      backend: BackendMode | "auto";
      reason: string;
      message: string;
      missing?: string;
    };

export function readBackendMode(value: string | undefined): BackendMode | "invalid" {
  const mode = value?.trim().toLowerCase() || "auto";
  if (mode === "auto" || mode === "codex" || mode === "builtin") return mode;
  return "invalid";
}

/** Which env var the built-in provider needs. Null when that provider is ready or unknown. */
export function missingBuiltinKey(model: string, env: EnvLike): string | null {
  const name = KEY_ENV[model.split("/")[0]];
  if (!name || env[name]) return null;
  return name;
}

/**
 * Prefer an authenticated local Codex CLI. `auto` falls back to the API-key
 * agent. `codex` never reads API keys. `builtin` never probes Codex.
 */
export function selectAssistantBackend(input: {
  mode: BackendMode | "invalid";
  probe?: ProbeResult;
  model: string;
  env: EnvLike;
}): AssistantChoice {
  if (input.mode === "invalid") {
    return {
      enabled: false,
      backend: "auto",
      reason: "invalid-backend",
      message: "AI 助手未启用：COPILOT_BACKEND 只能是 auto、codex 或 builtin",
    };
  }

  const blocker = codexBlocker(input.probe);
  if (input.mode === "codex" || (input.mode === "auto" && !blocker)) {
    if (blocker || !input.probe?.installed || input.probe.authed !== true) {
      return codexDisabled(blocker ?? "not-installed");
    }
    const model = input.env.CODEX_MODEL?.trim();
    return { enabled: true, backend: "codex", ...(model ? { model } : {}) };
  }

  const missing = missingBuiltinKey(input.model, input.env);
  if (missing) {
    if (input.mode === "auto" && input.probe?.installed && input.probe.authed === false) {
      return {
        enabled: false,
        backend: "auto",
        reason: "codex-unauthenticated",
        missing,
        message: `AI 助手未启用：Codex 未登录，且服务端没有设置 ${missing}`,
      };
    }
    if (input.mode === "auto" && input.probe?.installed && input.probe.authed === undefined) {
      return {
        enabled: false,
        backend: "auto",
        reason: "codex-unavailable",
        missing,
        message: `AI 助手未启用：无法确认 Codex 登录状态，且服务端没有设置 ${missing}`,
      };
    }
    return {
      enabled: false,
      backend: input.mode === "builtin" ? "builtin" : "auto",
      reason: "missing-key",
      missing,
      message: `AI 助手未启用：服务端没有设置 ${missing}`,
    };
  }

  return {
    enabled: true,
    backend: "builtin",
    model: input.model,
    ...(input.mode === "auto" && blocker ? { codex: blocker } : {}),
  };
}

function codexBlocker(probe: ProbeResult | undefined): "not-installed" | "unauthenticated" | "unavailable" | null {
  if (!probe?.installed) return "not-installed";
  if (probe.authed === true) return null;
  if (probe.authed === false) return "unauthenticated";
  return "unavailable";
}

function codexDisabled(blocker: "not-installed" | "unauthenticated" | "unavailable"): AssistantChoice {
  if (blocker === "unauthenticated") {
    return {
      enabled: false,
      backend: "codex",
      reason: "codex-unauthenticated",
      message: "AI 助手未启用：请先运行 codex login",
    };
  }
  if (blocker === "unavailable") {
    return {
      enabled: false,
      backend: "codex",
      reason: "codex-unavailable",
      message: "AI 助手未启用：无法确认 Codex 登录状态",
    };
  }
  return {
    enabled: false,
    backend: "codex",
    reason: "codex-not-installed",
    message: "AI 助手未启用：本机没有找到 codex 命令",
  };
}

export interface AssistantResolver {
  (): Promise<AssistantChoice>;
}

/** Cache Codex probes so the header status check and the chat request agree. */
export function createAssistantResolver(deps: {
  probe: () => Promise<ProbeResult>;
  env: EnvLike;
  now?: () => number;
  ttlMs?: number;
}): AssistantResolver {
  let cache: { at: number; result: ProbeResult } | undefined;
  const ttlMs = deps.ttlMs ?? 15_000;
  return async () => {
    const mode = readBackendMode(deps.env.COPILOT_BACKEND);
    let probe: ProbeResult | undefined;
    if (mode !== "builtin") {
      const now = deps.now?.() ?? Date.now();
      if (cache && now - cache.at < ttlMs) probe = cache.result;
      else {
        try {
          probe = await deps.probe();
          cache = { at: now, result: probe };
        } catch {
          probe = { installed: false };
        }
      }
    }
    return selectAssistantBackend({
      mode,
      probe,
      model: deps.env.COPILOT_MODEL?.trim() || DEFAULT_COPILOT_MODEL,
      env: deps.env,
    });
  };
}
