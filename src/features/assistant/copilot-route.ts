import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import type { CodexHarness, ProbeResult } from "@/features/codex-harness";
import { createAssistantResolver, type AssistantChoice, type EnvLike } from "./backend";
import { createCodexAgent } from "./codex-agent";
import { ASSISTANT_MAX_STEPS } from "./codex-turn";
import { ASSISTANT_PROMPT } from "./prompt";
import { allowedCopilotHosts, copilotAccessResponse } from "./request-guard";
import {
  codexBusyResponse,
  createSessionLimiter,
  createSessionPermit,
  holdSession,
  readCodexSessionLimit,
  type SessionPermit,
} from "./session-limit";

/**
 * A hung `codex` probe is abandoned after this long. The route then reports
 * the CLI as installed with unknown auth, which is the `unavailable` fallback.
 */
export const CODEX_PROBE_TIMEOUT_MS = 8_000;

export interface CopilotRouteDeps {
  env: EnvLike;
  harness: CodexHarness;
  /**
   * Working directory for Codex threads. Production omits this, so each run
   * gets an empty temp directory. Route tests pass a fixed path.
   */
  cwd?: string;
  /** Overrides {@link CODEX_PROBE_TIMEOUT_MS}. Tests pass a few dozen milliseconds. */
  probeTimeoutMs?: number;
}

export interface CopilotRouteHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
  /** HEAD must not enter the chat handler. Next would otherwise run GET and drop the body, leaking a Codex slot. */
  HEAD: (request: Request) => Response;
}

/**
 * CopilotKit handlers for `/api/copilotkit`. Tools stay in the browser.
 *
 * COPILOT_BACKEND=auto (default) uses a local `codex` CLI when `codex login`
 * has already succeeded, and otherwise the BuiltInAgent selected by
 * COPILOT_MODEL plus its API key. `codex` and `builtin` force one path.
 * Codex auth stays in ~/.codex; this route never reads it and does not need
 * OPENAI_API_KEY for that path. GET /api/copilotkit/status reports which
 * backend is active before the UI opens the assistant.
 *
 * Localhost and single-user only. The host must be on the loopback allowlist,
 * and a POST must be same-origin. Codex chat runs share a small concurrency
 * cap, held until that process exits.
 *
 * Production wires the real CLI harness in the Next route module. Tests pass
 * a fake harness and a private env object so the Codex path does not spawn `codex`.
 */
export function createCopilotRoute(deps: CopilotRouteDeps): CopilotRouteHandlers {
  const probeTimeoutMs = deps.probeTimeoutMs ?? CODEX_PROBE_TIMEOUT_MS;
  const resolveAssistant = createAssistantResolver({
    env: deps.env,
    probe: () => probeWithDeadline(deps.harness, probeTimeoutMs),
  });
  const codexSessions = createSessionLimiter(readCodexSessionLimit(deps.env.CODEX_MAX_SESSIONS));
  let builtinHandler: ((request: Request) => Promise<Response>) | undefined;

  function denied(request: Request) {
    return copilotAccessResponse(request, { allowedHosts: allowedCopilotHosts(deps.env) });
  }

  function builtinCopilotHandler(choice: Extract<AssistantChoice, { enabled: true; backend: "builtin" }>) {
    if (builtinHandler) return builtinHandler;
    const agent = new BuiltInAgent({ model: choice.model, prompt: ASSISTANT_PROMPT, maxSteps: ASSISTANT_MAX_STEPS });
    builtinHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({ agents: { default: agent } }),
      basePath: "/api/copilotkit",
    });
    return builtinHandler;
  }

  function codexCopilotHandler(
    choice: Extract<AssistantChoice, { enabled: true; backend: "codex" }>,
    permit: SessionPermit,
  ) {
    const agent = createCodexAgent({
      harness: deps.harness,
      prompt: ASSISTANT_PROMPT,
      model: choice.model,
      maxSteps: ASSISTANT_MAX_STEPS,
      permit,
      cwd: deps.cwd,
    });
    return createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({ agents: { default: agent } }),
      basePath: "/api/copilotkit",
    });
  }

  function head(request: Request) {
    const rejection = denied(request);
    if (rejection) return rejection;
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, POST, DELETE", "cache-control": "no-store" },
    });
  }

  async function handle(request: Request) {
    const rejection = denied(request);
    if (rejection) return rejection;

    const choice = await resolveAssistant();
    if (new URL(request.url).pathname === "/api/copilotkit/status") return Response.json(choice);
    if (!choice.enabled) {
      return Response.json(
        { message: choice.message, reason: choice.reason, ...(choice.missing ? { missing: choice.missing } : {}) },
        { status: 503 },
      );
    }
    if (choice.backend !== "codex") return builtinCopilotHandler(choice)(request);

    const release = codexSessions.tryAcquire();
    if (!release) return codexBusyResponse();
    const permit = createSessionPermit(release);
    try {
      const response = await codexCopilotHandler(choice, permit)(request);
      return holdSession(response, () => permit.releaseIfUnclaimed());
    } catch (error) {
      permit.releaseIfUnclaimed();
      throw error;
    }
  }

  return { GET: handle, POST: handle, DELETE: handle, HEAD: head };
}

async function probeWithDeadline(harness: CodexHarness, ms: number): Promise<ProbeResult> {
  try {
    return await withDeadline(harness.probe(), ms);
  } catch {
    // A timeout still means the CLI was invoked. Don't claim it is missing.
    return { installed: true };
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("codex probe timed out")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
