import type { ProbeResult } from "@/features/codex-harness";

/** Default BuiltInAgent model. Codex and Grok do not use this id. */
export const DEFAULT_COPILOT_MODEL = "anthropic/claude-sonnet-5-5";

const KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

/** `reason` of a status that gave up waiting for the CLI probes; the browser asks again. */
export const STATUS_TIMEOUT_REASON = "status-timeout";

export type BackendMode = "auto" | "codex" | "grok" | "builtin";

/** Why a local CLI backend (Codex or Grok) was not selected. */
export type CliBlocker = "not-installed" | "unauthenticated" | "unavailable";

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
      backend: "grok";
      /** Set only when `GROK_MODEL` is set. Otherwise Grok Build uses its own default. */
      model?: string;
      /** Why Codex was not selected, when `COPILOT_BACKEND=auto` fell through to Grok. */
      codex?: CliBlocker;
    }
  | {
      enabled: true;
      backend: "builtin";
      model: string;
      /** Why Codex was not selected, when `COPILOT_BACKEND=auto` fell back. */
      codex?: CliBlocker;
      /** Why Grok was not selected, when `COPILOT_BACKEND=auto` probed it and fell back. */
      grok?: CliBlocker;
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
  if (mode === "auto" || mode === "codex" || mode === "grok" || mode === "builtin") return mode;
  return "invalid";
}

/** Which env var the built-in provider needs. Null when that provider is ready or unknown. */
export function missingBuiltinKey(model: string, env: EnvLike): string | null {
  const name = KEY_ENV[model.split("/")[0]];
  if (!name || env[name]) return null;
  return name;
}

/**
 * `auto` order: an authenticated local Codex CLI, then an authenticated local
 * Grok Build CLI, then the API-key agent. `codex` and `grok` force one CLI and
 * never read API keys. `builtin` never probes either CLI.
 */
export function selectAssistantBackend(input: {
  mode: BackendMode | "invalid";
  probe?: ProbeResult;
  /** Grok Build probe. Omitted when it was not run (e.g. Codex was ready). */
  grokProbe?: ProbeResult;
  model: string;
  env: EnvLike;
}): AssistantChoice {
  if (input.mode === "invalid") {
    return {
      enabled: false,
      backend: "auto",
      reason: "invalid-backend",
      message: "AI 助手未启用：COPILOT_BACKEND 只能是 auto、codex、grok 或 builtin",
    };
  }

  if (input.mode === "grok") {
    const grok = cliBlocker(input.grokProbe);
    if (grok) return grokDisabled(grok);
    return grokChoice(input.env);
  }

  const blocker = codexBlocker(input.probe);
  if (input.mode === "codex" || (input.mode === "auto" && !blocker)) {
    if (blocker || !input.probe?.installed || input.probe.authed !== true) {
      return codexDisabled(blocker ?? "not-installed");
    }
    const model = input.env.CODEX_MODEL?.trim();
    return { enabled: true, backend: "codex", ...(model ? { model } : {}) };
  }

  const grokBlocker = input.mode === "auto" && input.grokProbe ? cliBlocker(input.grokProbe) : undefined;
  if (input.mode === "auto" && input.grokProbe && !grokBlocker) {
    return { ...grokChoice(input.env), ...(blocker ? { codex: blocker } : {}) };
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
    if (input.mode === "auto" && grokBlocker === "unauthenticated") {
      return {
        enabled: false,
        backend: "auto",
        reason: "grok-unauthenticated",
        missing,
        message: `AI 助手未启用：Grok 未登录（请运行 grok login），且服务端没有设置 ${missing}`,
      };
    }
    if (input.mode === "auto" && grokBlocker === "unavailable") {
      return {
        enabled: false,
        backend: "auto",
        reason: "grok-unavailable",
        missing,
        message: `AI 助手未启用：无法确认 Grok 登录状态，且服务端没有设置 ${missing}`,
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
    ...(grokBlocker ? { grok: grokBlocker } : {}),
  };
}

function codexBlocker(probe: ProbeResult | undefined): CliBlocker | null {
  return cliBlocker(probe);
}

function cliBlocker(probe: ProbeResult | undefined): CliBlocker | null {
  if (!probe?.installed) return "not-installed";
  if (probe.authed === true) return null;
  if (probe.authed === false) return "unauthenticated";
  return "unavailable";
}

function grokChoice(env: EnvLike): Extract<AssistantChoice, { backend: "grok"; enabled: true }> {
  const model = env.GROK_MODEL?.trim();
  return { enabled: true, backend: "grok", ...(model ? { model } : {}) };
}

function grokDisabled(blocker: CliBlocker): AssistantChoice {
  if (blocker === "unauthenticated") {
    return {
      enabled: false,
      backend: "grok",
      reason: "grok-unauthenticated",
      message: "AI 助手未启用：请先运行 grok login",
    };
  }
  if (blocker === "unavailable") {
    return {
      enabled: false,
      backend: "grok",
      reason: "grok-unavailable",
      message: "AI 助手未启用：无法确认 Grok 登录状态",
    };
  }
  return {
    enabled: false,
    backend: "grok",
    reason: "grok-not-installed",
    message: "AI 助手未启用：本机没有找到 grok 命令（Grok Build）",
  };
}

function codexDisabled(blocker: CliBlocker): AssistantChoice {
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

/** Cache CLI probes so the header status check and the chat request agree. */
export function createAssistantResolver(deps: {
  probe: () => Promise<ProbeResult>;
  /** Grok Build probe. Without it, `auto` behaves as Codex → builtin and `grok` reports not-installed. */
  probeGrok?: () => Promise<ProbeResult>;
  env: EnvLike;
  now?: () => number;
  ttlMs?: number;
}): AssistantResolver {
  const ttlMs = deps.ttlMs ?? 15_000;
  const codex = cachedProbe(deps.probe, ttlMs, deps.now);
  const grok = deps.probeGrok ? cachedProbe(deps.probeGrok, ttlMs, deps.now) : undefined;
  return async () => {
    const mode = readBackendMode(deps.env.COPILOT_BACKEND);
    let probe: ProbeResult | undefined;
    let grokProbe: ProbeResult | undefined;
    if (mode === "auto" || mode === "codex") probe = await codex();
    const codexReady = probe?.installed === true && probe.authed === true;
    if (mode === "grok" || (mode === "auto" && !codexReady)) {
      grokProbe = grok ? await grok() : { installed: false };
    }
    if (mode === "auto" && !grok) grokProbe = undefined;
    return selectAssistantBackend({
      mode,
      probe,
      grokProbe,
      model: deps.env.COPILOT_MODEL?.trim() || DEFAULT_COPILOT_MODEL,
      env: deps.env,
    });
  };
}

/** Cache a probe for `ttlMs`, and share one in flight, so a status check that gave up still fills the cache. */
function cachedProbe(
  probe: () => Promise<ProbeResult>,
  ttlMs: number,
  clock?: () => number,
): () => Promise<ProbeResult> {
  let cache: { at: number; result: ProbeResult } | undefined;
  let pending: Promise<ProbeResult> | undefined;
  return () => {
    const now = clock?.() ?? Date.now();
    if (cache && now - cache.at < ttlMs) return Promise.resolve(cache.result);
    pending ??= probe().then(
      (result) => {
        cache = { at: clock?.() ?? Date.now(), result };
        return result;
      },
      (): ProbeResult => ({ installed: false }),
    ).finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
