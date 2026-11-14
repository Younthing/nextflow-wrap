"use client";

import { CheckCircle2, CircleAlert, Loader2, Square } from "lucide-react";
import { ASSISTANT_ACTIVITY, assistantActivitySchema, type AssistantActivity } from "./activity";
import { useAssistantRunning } from "./tool-record";

const statuses = {
  running: { Icon: Loader2, text: "执行中", tone: "text-primary motion-safe:animate-spin" },
  completed: { Icon: CheckCircle2, text: "已完成", tone: "text-success" },
  failed: { Icon: CircleAlert, text: "失败", tone: "text-destructive" },
  stopped: { Icon: Square, text: "已停止", tone: "text-muted-foreground" },
};

function ActivityCard({ content }: { content: AssistantActivity }) {
  const running = useAssistantRunning();
  const status = content.status === "running" && !running ? "stopped" : content.status;
  const { Icon, text, tone } = statuses[status];
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <Icon aria-hidden className={`size-4 shrink-0 ${tone}`} />
      <span className="min-w-0 flex-1">{content.label}</span>
      <span className="shrink-0 text-xs text-muted-foreground" role="status">{text}</span>
    </div>
  );
}

export const assistantActivityRenderers = [{
  activityType: ASSISTANT_ACTIVITY,
  content: assistantActivitySchema,
  render: ActivityCard,
}];
