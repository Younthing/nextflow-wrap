import type { AssistantModule } from "./contract";

export const RUN_LOG_TAIL = 120;

export const CANCEL_RUN_DESCRIPTION =
  "停止用户正在查看的这次运行。调用后会弹出确认对话框，只有用户接受才会调用取消接口。已经结束的运行不能停止。你必须等这个工具返回后再说运行已停止。";

export const RESUME_RUN_DESCRIPTION =
  "从用户正在查看的、已结束且有 Nextflow session 的运行恢复（-resume）。调用后会弹出确认对话框，只有用户接受才会提交恢复。你必须等这个工具返回后再说已经恢复。";

const prompt = `## 运行诊断
- 用户在运行页面时，上下文里有这次运行的状态、失败任务和参数。解释失败原因时先用 get_task_log 读失败任务的 .command.log，必要时用 get_run_log 看 Nextflow 主日志，再给出具体的修复建议（改参数、换资源标签、修正连线等）。
- 运行详情页有 cancel_run 和 resume_run，用来停止当前运行或从当前已结束的运行恢复。
- 调用 cancel_run 或 resume_run 后必须停下来等工具返回。工具会先弹出确认对话框，用户点确认之前不会停止或恢复。取消、关闭对话框或中断都不会执行。不要在返回前说已经停止或恢复。
- 返回 blocked 和 problems 时说明原因。返回 declined 表示用户没有确认，不要立刻再次调用，除非用户明确改口。`;

/** Run explanation plus stop/resume. Both control tools wait on the host confirm dialog. */
export const runDiagnosticsModule = {
  id: "run-diagnostics",
  title: "运行诊断",
  defaultActive: true,
  prompt,
  tools: [
    {
      name: "get_task_log",
      description: "读取这次运行中某个任务的 .command.log（任务名或哈希）。",
    },
    {
      name: "get_run_log",
      description: `读取 Nextflow 主日志（.nextflow.log 的控制台输出）最后 ${RUN_LOG_TAIL} 行。`,
    },
    { name: "cancel_run", description: CANCEL_RUN_DESCRIPTION },
    { name: "resume_run", description: RESUME_RUN_DESCRIPTION },
  ],
} as const satisfies AssistantModule;
