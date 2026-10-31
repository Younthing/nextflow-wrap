import { BuiltInAgent } from "@copilotkit/runtime/v2";

import type { CodexHarness } from "@/features/codex-harness";
import { ASSISTANT_MAX_STEPS, runCodexAssistant } from "./codex-turn";
import type { SessionPermit } from "./session-limit";

export interface CodexAgentOptions {
  harness: CodexHarness;
  prompt: string;
  model?: string;
  maxSteps?: number;
  /** Present for HTTP chat runs so the slot stays held until the process exits. */
  permit?: SessionPermit;
  /**
   * Set only by route tests. A chat run omits this and gets an empty temp directory.
   */
  cwd?: string;
}

/**
 * CopilotKit custom agent. Browser tools stay browser-side: a Codex reply that
 * is only a known tool JSON object becomes AG-UI tool-call events, and the next
 * request brings the tool result back in the transcript. A chat run gets an
 * empty temp directory when `cwd` is omitted, and stops after `maxSteps` model
 * replies in the current turn.
 */
export function createCodexAgent(options: CodexAgentOptions) {
  const maxSteps = options.maxSteps ?? ASSISTANT_MAX_STEPS;
  return new BuiltInAgent({
    type: "custom",
    factory: (ctx) => runCodexAssistant(ctx.input, {
      harness: options.harness,
      prompt: options.prompt,
      cwd: options.cwd,
      model: options.model,
      signal: ctx.abortSignal,
      maxSteps,
      permit: options.permit,
    }) as AsyncIterable<never>, // AG-UI events; the factory's event type is not a direct import.
  });
}
