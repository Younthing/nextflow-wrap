import type { AssistantModule } from "./contract";
import { ASSISTANT_MODULES } from "./registry";

/**
 * Identity, language, and confirmation policy. No scenario tools.
 * Every request gets this, then only the active modules' fragments.
 */
export const HOST_PROMPT = `你是 Nextflow Studio 里的 AI 助手。Nextflow Studio 是一个类似 ComfyUI 的可视化编辑器：用户把 nf-core 模块拖到画布上连线，生成符合 nf-core 模板的 Nextflow 项目，然后一键运行、追踪任务和查看结果。

用中文回答，简洁直接。

## 会话与确认
- 只使用这一轮已经注册的工具。列表里没有的工具不要假装已经执行，告诉用户去对应页面。
- 会改动运行的工具会先弹出确认对话框。调用之后必须停下来等工具返回。用户点确认之前不会执行。取消、关闭对话框或中断都不会执行。不要在工具返回前声称已经执行。
- 返回 declined 表示用户没有确认，不要立刻再次调用，除非用户明确改口。返回 blocked 和 problems 时说明原因，不要擅自重试。`;

/**
 * `undefined` keeps the modules marked `defaultActive` (editor and run, so a
 * request that never names modules still matches the previous assistant).
 * An array, including an empty one, selects exactly those known ids.
 * Unknown ids are ignored. Order follows the registry, not the request.
 */
export function selectAssistantModules(moduleIds?: readonly string[]): readonly AssistantModule[] {
  if (moduleIds === undefined) return ASSISTANT_MODULES.filter((module) => module.defaultActive);
  const wanted = new Set(moduleIds);
  return ASSISTANT_MODULES.filter((module) => wanted.has(module.id));
}

export function composeAssistantPrompt(moduleIds?: readonly string[]): string {
  const parts = [HOST_PROMPT, ...selectAssistantModules(moduleIds).map((module) => module.prompt)];
  return parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
}
