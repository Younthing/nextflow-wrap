import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { ASSISTANT_PROMPT } from "@/features/assistant/prompt";

/*
 * CopilotKit runtime for the AI assistant. The model runs here so the API key
 * stays on the server; the tools it calls (add a module, connect nodes, read a
 * task log, …) are registered by the browser and run there.
 *
 * COPILOT_MODEL picks the model as `<provider>/<model>`; the matching key
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_API_KEY) must be set. Without
 * one every request answers 503 and the UI hides the assistant; the UI asks
 * GET /api/copilotkit/status first so it never has to hit that error.
 */

const MODEL = process.env.COPILOT_MODEL || "anthropic/claude-sonnet-5-5";

const KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

function missingKey() {
  const env = KEY_ENV[MODEL.split("/")[0]];
  return env && !process.env[env] ? env : null;
}

let handler: ((request: Request) => Promise<Response>) | null = null;

function getHandler() {
  handler ??= createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: {
        default: new BuiltInAgent({ model: MODEL, prompt: ASSISTANT_PROMPT, maxSteps: 12 }),
      },
    }),
    basePath: "/api/copilotkit",
  });
  return handler;
}

async function handle(request: Request) {
  const missing = missingKey();
  if (new URL(request.url).pathname === "/api/copilotkit/status") {
    return Response.json(
      missing ? { enabled: false, message: `AI 助手未启用：服务端没有设置 ${missing}` } : { enabled: true, model: MODEL },
    );
  }
  if (missing) {
    return Response.json(
      { message: `AI 助手未启用：服务端没有设置 ${missing}`, missing },
      { status: 503 },
    );
  }
  return getHandler()(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
