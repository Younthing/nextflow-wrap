import { createCopilotRoute } from "@/features/assistant/copilot-route";
import { createCodexHarness } from "@/features/codex-harness";

/*
 * CopilotKit runtime for the AI assistant. Tools stay in the browser.
 * Scenario prompts come from assistant modules; this file only wires the harness.
 *
 * This module builds the real CLI harness and injects it into
 * `createCopilotRoute`. Tests call that factory with a fake harness so CI
 * never spawns `codex`.
 */

const route = createCopilotRoute({
  env: process.env,
  harness: createCodexHarness({
    binaryPath: process.env.CODEX_BIN,
    requestTimeoutMs: 20_000,
  }),
});

export const GET = route.GET;
export const POST = route.POST;
export const DELETE = route.DELETE;
export const HEAD = route.HEAD;
