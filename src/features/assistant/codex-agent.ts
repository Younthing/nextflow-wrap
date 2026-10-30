import { BuiltInAgent } from "@copilotkit/runtime/v2";

import type { CodexHarness } from "@/features/codex-harness";
import { runCodexAssistant } from "./codex-turn";

export interface CodexAgentOptions {
  harness: CodexHarness;
  prompt: string;
  cwd: string;
  model?: string;
}

/**
 * CopilotKit custom agent. Browser tools stay browser-side: a Codex reply that
 * is a single tool JSON object becomes AG-UI tool-call events, and the next
 * request brings the tool result back in the transcript.
 */
export function createCodexAgent(options: CodexAgentOptions) {
  return new BuiltInAgent({
    type: "custom",
    factory: (ctx) => runCodexAssistant(ctx.input, {
      harness: options.harness,
      prompt: options.prompt,
      cwd: options.cwd,
      model: options.model,
      signal: ctx.abortSignal,
    }) as AsyncIterable<never>, // AG-UI events; the factory's event type is not a direct import.
  });
}
