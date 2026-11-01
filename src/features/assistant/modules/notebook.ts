import type { AssistantModule } from "./contract";

/** Prompt-only until notebook tools exist. Mounting it still isolates the prompt. */
export const notebookModule = {
  id: "notebook",
  title: "笔记本",
  defaultActive: false,
  prompt: `## 笔记本
- 用户正在编辑脚本笔记本。单元格可以是说明、代码、输入或输出。用 \`# @input\` / \`# @output\` 标出端口；标了输入或输出之后，这本才准备进入后续步骤。
- 这一模块没有改笔记本的工具。不要假装已经修改单元格、切换内核或执行了代码。需要改内容时说明该改哪一格，让用户在编辑器里完成。
- 试跑和执行由页面上的按钮触发，不要声称已经跑过。`,
  tools: [],
} as const satisfies AssistantModule;
