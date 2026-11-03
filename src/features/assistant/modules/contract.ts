/**
 * Assistant module contract, shaped like VS Code's Language Model Tools split.
 *
 * - Host (Copilot route, provider): session, backend, concurrency, the confirm
 *   dialog. It registers no tools and carries no scenario instructions.
 * - Module (this contract): id, a standalone prompt fragment, and the name and
 *   description of each tool. Like a `languageModelTools` contribution.
 * - Surface (`../surfaces/*`): mounted on the page that owns the store. It calls
 *   `useAssistantModule(id)` and registers the tools with `useFrontendTool`.
 * - Domain (`features/<domain>/assistant-actions.ts`): what the tools do,
 *   written against that domain's store or command API.
 *
 * Only mounted modules reach the model. A request names them in
 * {@link ASSISTANT_MODULES_PROP}; no list means no scenario at all.
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
  /** Browser tools this module's surface registers. Empty when the module is prompt-only. */
  tools: readonly AssistantToolSpec[];
}

export function moduleTool<const T extends AssistantModule>(
  module: T,
  name: T["tools"][number]["name"],
): AssistantToolSpec {
  const tool = module.tools.find((item) => item.name === name);
  if (!tool) throw new Error(`助手模块 ${module.id} 没有工具 ${name}`);
  return tool;
}
