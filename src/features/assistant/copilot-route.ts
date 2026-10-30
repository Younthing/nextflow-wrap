import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { createCodexHarness, type ProbeResult } from "@/features/codex-harness";
import { createAssistantResolver, type AssistantChoice } from "./backend";
import { createCodexAgent } from "./codex-agent";
import { ASSISTANT_MAX_STEPS } from "./codex-turn";
import { ASSISTANT_PROMPT } from "./prompt";
import { allowedCopilotHosts, copilotAccessResponse } from "./request-guard";
import { codexBusyResponse, createSessionLimiter, createSessionPermit, holdSession, readCodexSessionLimit } from "./session-limit";

/*
 * CopilotKit runtime for the AI assistant. Tools stay in the browser.
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
 * cap, held until that process exits. Each run's cwd is an empty temp directory.
 */

const harness = createCodexHarness({
  binaryPath: process.env.CODEX_BIN,
  requestTimeoutMs: 20_000,
});

const resolveAssistant = createAssistantResolver({
  env: process.env,
  probe: () => probeCodex(),
});

const codexSessions = createSessionLimiter(readCodexSessionLimit(process.env.CODEX_MAX_SESSIONS));

let builtinHandler: ((request: Request) => Promise<Response>) | undefined;

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
  permit: ReturnType<typeof createSessionPermit>,
) {
  const agent = createCodexAgent({
    harness,
    prompt: ASSISTANT_PROMPT,
    model: choice.model,
    maxSteps: ASSISTANT_MAX_STEPS,
    permit,
  });
  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({ agents: { default: agent } }),
    basePath: "/api/copilotkit",
  });
}

async function probeCodex(): Promise<ProbeResult> {
  try {
    return await withDeadline(harness.probe(), 8_000);
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

/** HEAD must not enter the chat handler. Next would otherwise run GET and drop the body, leaking a Codex slot. */
export function headCopilot(request: Request) {
  const denied = copilotAccessResponse(request, { allowedHosts: allowedCopilotHosts(process.env) });
  if (denied) return denied;
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, POST, DELETE", "cache-control": "no-store" },
  });
}

export async function handleCopilotRequest(request: Request) {
  const denied = copilotAccessResponse(request, { allowedHosts: allowedCopilotHosts(process.env) });
  if (denied) return denied;

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

export const GET = handleCopilotRequest;
export const POST = handleCopilotRequest;
export const DELETE = handleCopilotRequest;
export const HEAD = headCopilot;
