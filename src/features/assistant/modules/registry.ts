import type { AssistantModule } from "./contract";
import { canvasEditModule } from "./canvas-edit";
import { envConfigModule } from "./env-config";
import { notebookModule } from "./notebook";
import { publishModule } from "./publish";
import { runDiagnosticsModule } from "./run-diagnostics";

/**
 * Modules the host knows how to load. Order is the prompt order.
 * Register a new module here; do not special-case it in the Copilot route.
 */
export const ASSISTANT_MODULES: readonly AssistantModule[] = [
  canvasEditModule,
  runDiagnosticsModule,
  notebookModule,
  publishModule,
  envConfigModule,
];

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertRegistry(modules: readonly AssistantModule[]) {
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const entry of modules) {
    if (!ID_PATTERN.test(entry.id)) throw new Error(`助手模块 id 不合法：${entry.id}`);
    if (ids.has(entry.id)) throw new Error(`助手模块 id 重复：${entry.id}`);
    ids.add(entry.id);
    if (!entry.title.trim() || !entry.prompt.trim()) throw new Error(`助手模块 ${entry.id} 缺少标题或提示词`);
    for (const tool of entry.tools) {
      if (!tool.name || !tool.description.trim()) throw new Error(`助手模块 ${entry.id} 的工具声明不完整`);
      if (tools.has(tool.name)) throw new Error(`助手工具名重复：${tool.name}`);
      tools.add(tool.name);
    }
  }
}

assertRegistry(ASSISTANT_MODULES);
