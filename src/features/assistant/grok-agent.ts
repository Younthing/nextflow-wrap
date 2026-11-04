import { BuiltInAgent } from "@copilotkit/runtime/v2";

import type { GrokHarness } from "@/features/grok-harness";
import { ASSISTANT_MAX_STEPS, runAgentAssistant, type CodexAguiEvent, type PromptInput } from "./codex-turn";
import type { SessionPermit } from "./session-limit";

export interface GrokAgentOptions {
  harness: GrokHarness;
  prompt: string;
  model?: string;
  maxSteps?: number;
  /** Present for HTTP chat runs so the slot stays held until the process exits. */
  permit?: SessionPermit;
  /** Set only by route tests. A chat run omits this and gets an empty temp directory. */
  cwd?: string;
}

export interface GrokAssistantRun extends Omit<GrokAgentOptions, "maxSteps"> {
  maxSteps?: number;
  signal?: AbortSignal;
}

/**
 * One CopilotKit run on local Grok Build: a short-lived `grok agent stdio`
 * session in an empty temp directory (strict sandbox, chat-only agent profile,
 * permission prompts rejected), then AG-UI text or one browser tool call.
 */
export function runGrokAssistant(input: PromptInput, options: GrokAssistantRun): AsyncGenerator<CodexAguiEvent> {
  return runAgentAssistant(input, {
    label: "Grok",
    tempPrefix: "nextflow-grok-",
    prompt: options.prompt,
    cwd: options.cwd,
    maxSteps: options.maxSteps,
    signal: options.signal,
    permit: options.permit,
    open: (cwd) => options.harness.open({ cwd, model: options.model, permission: "reject" }),
  });
}

/** CopilotKit custom agent for Grok Build. Same browser-tool bridge as {@link createCodexAgent}. */
export function createGrokAgent(options: GrokAgentOptions) {
  const maxSteps = options.maxSteps ?? ASSISTANT_MAX_STEPS;
  return new BuiltInAgent({
    type: "custom",
    factory: (ctx) => runGrokAssistant(ctx.input, {
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
