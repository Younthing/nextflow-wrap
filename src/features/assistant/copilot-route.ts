import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import type { CodexHarness, ProbeResult } from "@/features/codex-harness";
import type { GrokHarness } from "@/features/grok-harness";
import { createAssistantResolver, STATUS_TIMEOUT_REASON, type AssistantChoice, type EnvLike } from "./backend";
import { createCodexAgent } from "./codex-agent";
import { ASSISTANT_MAX_STEPS } from "./codex-turn";
import { createGrokAgent } from "./grok-agent";
import { requestAssistantPrompt } from "./modules/request";
import { allowedCopilotHosts, copilotAccessResponse } from "./request-guard";
import { readConversationTitle, TITLE_PROMPT, TITLE_REQUEST_LIMIT } from "./conversation-title";
import { isRecord } from "@/lib/record";
import {
  busyResponse,
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
/**
 * How long `/api/copilotkit/status` waits for the CLI probes. Past it the status says so and the probes keep
 * running; their results are cached, so the browser's retry gets the real answer.
 */
export const STATUS_TIMEOUT_MS = 3_000;

export interface CopilotRouteDeps {
  env: EnvLike;
  harness: CodexHarness;
  /** Local Grok Build (`grok agent stdio`). Omitted: `grok` is never selected. */
  grokHarness?: GrokHarness;
  /**
   * Working directory for Codex and Grok sessions. Production omits this, so each run
   * gets an empty temp directory. Route tests pass a fixed path.
   */
  cwd?: string;
  /** Overrides {@link CODEX_PROBE_TIMEOUT_MS}. Tests pass a few dozen milliseconds. */
  probeTimeoutMs?: number;
  /** Overrides {@link STATUS_TIMEOUT_MS}. */
  statusTimeoutMs?: number;
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
 * The prompt is the host preamble plus whichever modules the request names.
 * This route does not register tools or contain a scenario's instructions.
 *
 * COPILOT_BACKEND=auto (default) uses a local `codex` CLI when `codex login`
 * has already succeeded, then a local Grok Build CLI when `grok login` has,
 * and otherwise the BuiltInAgent selected by COPILOT_MODEL plus its API key.
 * `codex`, `grok` and `builtin` force one path. CLI auth stays in ~/.codex
 * and ~/.grok; this route never reads either and needs no API key for those
 * paths. GET /api/copilotkit/status reports which backend is active before
 * the UI opens the assistant.
 *
 * Localhost and single-user only. The host must be on the loopback allowlist,
 * and a POST must be same-origin. Codex chat runs share a small concurrency
 * cap (CODEX_MAX_SESSIONS), and Grok runs have their own (GROK_MAX_SESSIONS),
 * each held until that process exits.
 *
 * Production wires the real CLI harness in the Next route module. Tests pass
 * a fake harness and a private env object so the Codex path does not spawn `codex`.
 */
export function createCopilotRoute(deps: CopilotRouteDeps): CopilotRouteHandlers {
  const probeTimeoutMs = deps.probeTimeoutMs ?? CODEX_PROBE_TIMEOUT_MS;
  const statusTimeoutMs = deps.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
  const resolveAssistant = createAssistantResolver({
    env: deps.env,
    probe: () => probeWithDeadline(deps.harness, probeTimeoutMs),
    ...(deps.grokHarness ? { probeGrok: () => probeWithDeadline(deps.grokHarness!, probeTimeoutMs) } : {}),
  });
  const codexSessions = createSessionLimiter(readCodexSessionLimit(deps.env.CODEX_MAX_SESSIONS));
  const grokSessions = createSessionLimiter(readCodexSessionLimit(deps.env.GROK_MAX_SESSIONS));
  const builtinHandlers = new Map<string, (request: Request) => Promise<Response>>();

  function denied(request: Request) {
    return copilotAccessResponse(request, { allowedHosts: allowedCopilotHosts(deps.env) });
  }

  function builtinCopilotHandler(
    choice: Extract<AssistantChoice, { enabled: true; backend: "builtin" }>,
    prompt: string,
  ) {
    const key = `${choice.model}\0${prompt}`;
    const existing = builtinHandlers.get(key);
    if (existing) return existing;
    const agent = new BuiltInAgent({ model: choice.model, prompt, maxSteps: ASSISTANT_MAX_STEPS });
    const handler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({ agents: { default: agent } }),
      basePath: "/api/copilotkit",
    });
    builtinHandlers.set(key, handler);
    return handler;
  }

  function codexCopilotHandler(
    choice: Extract<AssistantChoice, { enabled: true; backend: "codex" }>,
    permit: SessionPermit,
    prompt: string,
  ) {
    const agent = createCodexAgent({
      harness: deps.harness,
      prompt,
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

  function grokCopilotHandler(
    harness: GrokHarness,
    choice: Extract<AssistantChoice, { enabled: true; backend: "grok" }>,
    permit: SessionPermit,
    prompt: string,
  ) {
    const agent = createGrokAgent({
      harness,
      prompt,
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

  async function runCli(
    limiter: typeof codexSessions,
    busy: () => Response,
    handler: (permit: SessionPermit) => (request: Request) => Promise<Response>,
    request: Request,
  ) {
    const release = limiter.tryAcquire();
    if (!release) return busy();
    const permit = createSessionPermit(release);
    try {
      const response = await handler(permit)(request);
      return holdSession(response, () => permit.releaseIfUnclaimed());
    } catch (error) {
      permit.releaseIfUnclaimed();
      throw error;
    }
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

    const path = new URL(request.url).pathname;
    if (path === "/api/copilotkit/status") return Response.json(await resolveStatus());
    if (path === "/api/copilotkit/title" && request.method === "POST") return title(request);
    const choice = await resolveAssistant();
    if (!choice.enabled) {
      return Response.json(
        { message: choice.message, reason: choice.reason, ...(choice.missing ? { missing: choice.missing } : {}) },
        { status: 503 },
      );
    }
    const prepared = await requestAssistantPrompt(request);
    return dispatch(choice, prepared.request, prepared.prompt);
  }

  function dispatch(choice: Extract<AssistantChoice, { enabled: true }>, request: Request, prompt: string) {
    if (choice.backend === "codex") {
      return runCli(
        codexSessions,
        codexBusyResponse,
        (permit) => codexCopilotHandler(choice, permit, prompt),
        request,
      );
    }
    if (choice.backend === "grok") {
      const grok = deps.grokHarness;
      if (!grok) return Response.json({ message: "AI 助手未启用：服务端没有接入 Grok Build", reason: "grok-not-installed" }, { status: 503 });
      return runCli(
        grokSessions,
        () => busyResponse("Grok"),
        (permit) => grokCopilotHandler(grok, choice, permit, prompt),
        request,
      );
    }
    return builtinCopilotHandler(choice, prompt)(request);
  }

  async function title(request: Request) {
    const raw = await request.text();
    if (raw.length > TITLE_REQUEST_LIMIT) return new Response(null, { status: 413 });
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
    if (!isRecord(input) || typeof input.question !== "string" || typeof input.answer !== "string"
      || !input.question.trim() || !input.answer.trim()) return new Response(null, { status: 400 });
    const choice = await resolveAssistant();
    if (!choice.enabled) return new Response(null, { status: 204 });
    const threadId = crypto.randomUUID();
    const url = new URL("/api/copilotkit/agent/default/run", request.url);
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    headers.set("accept", "text/event-stream");
    const run = new Request(url, {
      method: "POST", headers,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      body: JSON.stringify({
        protocolVersion: "1.0", threadId, runId: crypto.randomUUID(), tools: [], context: [], state: {},
        messages: [{ id: crypto.randomUUID(), role: "user", content: JSON.stringify({ question: input.question, answer: input.answer }) }],
      }),
    });
    try {
      const response = await dispatch(choice, run, TITLE_PROMPT);
      if (!response.ok) {
        await response.body?.cancel();
        return new Response(null, { status: 204 });
      }
      const name = await readConversationTitle(response);
      return name ? Response.json({ title: name }) : new Response(null, { status: 204 });
    } catch {
      return new Response(null, { status: 204 });
    }
  }

  /** The status the UI shows. It never waits longer than {@link STATUS_TIMEOUT_MS} for the CLI probes. */
  async function resolveStatus(): Promise<AssistantChoice> {
    try {
      return await withDeadline(resolveAssistant(), statusTimeoutMs);
    } catch {
      return { enabled: false, backend: "auto", reason: STATUS_TIMEOUT_REASON, message: "AI 助手状态检查超时，稍后自动重试" };
    }
  }

  return { GET: handle, POST: handle, DELETE: handle, HEAD: head };
}

async function probeWithDeadline(harness: { probe(): Promise<ProbeResult> }, ms: number): Promise<ProbeResult> {
  try {
    return await withDeadline(harness.probe(), ms);
  } catch {
    // A timeout still means the CLI was invoked. Don't claim it is missing.
    return { installed: true };
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CLI probe timed out")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
