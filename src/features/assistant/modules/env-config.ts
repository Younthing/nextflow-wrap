import type { AssistantModule } from "./contract";

/** Prompt-only. Conda and container stay hand-filled on the env form. */
export const envConfigModule = {
  id: "env-config",
  title: "环境配置",
  defaultActive: false,
  prompt: `## 环境配置
- 脚本模块的运行环境是手填的 conda yaml 路径和容器地址，写进 process 的 conda / container。空白表示不设置。路径和地址不能包含换行或控制字符。
- 这一模块没有修改环境的工具。不要另编执行器、镜像或 conda 文件内容。需要改时告诉用户在环境表单里填写。`,
  tools: [],
} as const satisfies AssistantModule;
