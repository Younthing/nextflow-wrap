import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { createAssistantResolver, type AssistantChoice } from "@/features/assistant/backend";
import { createCodexAgent } from "@/features/assistant/codex-agent";
import { ASSISTANT_PROMPT } from "@/features/assistant/prompt";
import { createCodexHarness, type ProbeResult } from "@/features/codex-harness";

/*
 * CopilotKit runtime for the AI assistant. Tools stay in the browser.
 *
 * COPILOT_BACKEND=auto (default) uses a local `codex` CLI when `codex login`
 * has already succeeded, and otherwise the BuiltInAgent selected by
 * COPILOT_MODEL plus its API key. `codex` and `builtin` force one path.
 * Codex auth stays in ~/.codex; this route never reads it and does not need
 * OPENAI_API_KEY for that path. GET /api/copilotkit/status reports which
 * backend is active before the UI opens the assistant.
 */

const harness = createCodexHarness({
  binaryPath: process.env.CODEX_BIN,
  requestTimeoutMs: 20_000,
});

const resolveAssistant = createAssistantResolver({
  env: process.env,
  probe: () => probeCodex(),
});

const handlers = new Map<"codex" | "builtin", (request: Request) => Promise<Response>>();

function handlerFor(choice: Extract<AssistantChoice, { enabled: true }>) {
  const cached = handlers.get(choice.backend);
  if (cached) return cached;
  const agent = choice.backend === "codex"
    ? createCodexAgent({
      harness,
      prompt: ASSISTANT_PROMPT,
      cwd: process.cwd(),
      model: choice.model,
    })
    : new BuiltInAgent({ model: choice.model, prompt: ASSISTANT_PROMPT, maxSteps: 12 });
  const handler = createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({ agents: { default: agent } }),
    basePath: "/api/copilotkit",
  });
  handlers.set(choice.backend, handler);
  return handler;
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

async function handle(request: Request) {
  const choice = await resolveAssistant();
  if (new URL(request.url).pathname === "/api/copilotkit/status") return Response.json(choice);
  if (!choice.enabled) {
    return Response.json(
      { message: choice.message, reason: choice.reason, ...(choice.missing ? { missing: choice.missing } : {}) },
      { status: 503 },
    );
  }
  return handlerFor(choice)(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
