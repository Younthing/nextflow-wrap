import { createCopilotRoute } from "@/features/assistant/copilot-route";
import { createCodexHarness } from "@/features/codex-harness";
import { createGrokHarness } from "@/features/grok-harness";

/*
 * CopilotKit runtime for the AI assistant. Tools stay in the browser.
 * Scenario prompts come from assistant modules; this file only wires the harness.
 *
 * This module builds the real CLI harnesses (Codex app-server and Grok Build
 * ACP) and injects them into `createCopilotRoute`. Tests call that factory
 * with fake harnesses so CI never spawns `codex` or `grok`.
 */

const route = createCopilotRoute({
  env: process.env,
  harness: createCodexHarness({
    binaryPath: process.env.CODEX_BIN,
    requestTimeoutMs: 20_000,
  }),
  grokHarness: createGrokHarness({
    binaryPath: process.env.GROK_BIN,
    sandbox: process.env.GROK_CHAT_SANDBOX,
    requestTimeoutMs: 20_000,
  }),
});

export const GET = route.GET;
export const POST = route.POST;
export const DELETE = route.DELETE;
export const HEAD = route.HEAD;
