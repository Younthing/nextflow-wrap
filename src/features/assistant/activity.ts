import { z } from "zod";

export const ASSISTANT_ACTIVITY = "fluora.agent-step";

export const assistantActivitySchema = z.object({
  label: z.string(),
  status: z.enum(["running", "completed", "failed", "stopped"]),
});

export type AssistantActivity = z.infer<typeof assistantActivitySchema>;

const toolLabels: Record<string, string> = {
  commandExecution: "执行命令",
  fileChange: "处理文件",
  webSearch: "搜索网页",
  mcpToolCall: "调用外部工具",
  dynamicToolCall: "调用工具",
  run_terminal_command: "执行命令",
  read_file: "读取文件",
  write_file: "写入文件",
  list_files: "列出文件",
};

/** The chat shows the action category. CLI arguments and raw output stay in the harness. */
export function activityLabel(tool: string): string {
  return Object.hasOwn(toolLabels, tool) ? toolLabels[tool] : "调用工具";
}

export function activityStatus(status?: string): AssistantActivity["status"] {
  if (status === "cancelled" || status === "interrupted" || status === "aborted") return "stopped";
  if (status === "failed" || status === "error" || status === "declined") return "failed";
  return "completed";
}
