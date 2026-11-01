import type { AssistantModule } from "./contract";

/** Prompt-only. Publishing stays on the wizard until a module tool is added. */
export const publishModule = {
  id: "publish",
  title: "发布",
  defaultActive: false,
  prompt: `## 发布
- 把笔记本发布成脚本模块前，需要模块名、说明、至少一个输出端口，以及一次通过的试跑。
- 这一模块没有发布工具。不要假装已经写入模块库。引导用户使用页面上的「发布为模块」。
- 环境路径不在这一模块里填写。`,
  tools: [],
} as const satisfies AssistantModule;
