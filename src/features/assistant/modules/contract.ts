/**
 * Assistant module contract.
 *
 * The host owns the session (Copilot route, provider, concurrency) and the
 * confirmation dialog. A module owns one prompt fragment and the browser tools
 * it registers. Adding a scenario means adding a module and mounting it on
 * its page — not editing the Copilot route.
 *
 * Page mount is `useAssistantModule(id)` (or a thin surface component).
 * Unmount removes that id from the next request. That is the hook a later
 * per-page lifecycle can call; this skeleton does not add a router loader.
 */

export const ASSISTANT_MODULES_PROP = "assistantModules";

export interface AssistantToolSpec {
  /** CopilotKit tool name. Unique across every module. */
  name: string;
  /** Shown to the model only while this module's tool is registered. */
  description: string;
}

export interface AssistantModule {
  /** Stable id. Lowercase words separated by hyphens. */
  id: string;
  title: string;
  /**
   * System-prompt fragment. Included only when this module is active.
   * It must stand alone and must not name another module's tools.
   */
  prompt: string;
  /** Browser tools this module registers. Empty when the module is prompt-only. */
  tools: readonly AssistantToolSpec[];
  /**
   * Used when a request omits {@link ASSISTANT_MODULES_PROP} (older clients
   * and direct route tests). A mounted page sends an explicit list instead.
   */
  defaultActive: boolean;
}

export function moduleTool<const T extends AssistantModule>(
  module: T,
  name: T["tools"][number]["name"],
): AssistantToolSpec {
  const tool = module.tools.find((item) => item.name === name);
  if (!tool) throw new Error(`助手模块 ${module.id} 没有工具 ${name}`);
  return tool;
}
