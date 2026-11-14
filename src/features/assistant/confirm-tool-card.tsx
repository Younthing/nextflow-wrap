"use client";

import { ToolCallStatus } from "@copilotkit/react-core/v2";

import { messageFromToolResult } from "./confirm";
import { ToolResultLink, useAssistantRunning } from "./tool-record";
import { isRecord } from "@/lib/record";
import { Button } from "@/components/ui/button";
import { ChangePreview } from "./change-preview";
import { usePendingConfirmation } from "./pending-confirmation";

export function ConfirmToolCard({ status, result, toolCallId }: { status: ToolCallStatus; result?: string; toolCallId?: string }) {
  const pending = usePendingConfirmation(toolCallId);
  const running = useAssistantRunning();
  const waiting = status !== ToolCallStatus.Complete;
  let data: unknown;
  try { data = result && JSON.parse(result); } catch { /* Free-form tool result. */ }
  if (waiting && pending) {
    const { view } = pending;
    return (
      <section aria-label={view.title} className="grid gap-2 rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">{view.title}</p>
        <p className="text-muted-foreground">{view.message}</p>
        {view.itemList.map((item) => <p key={item} className="text-xs">{item}</p>)}
        {view.preview && <ChangePreview {...view.preview} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={pending.decline}>取消</Button>
          <Button size="sm" variant={view.type === "delete" ? "destructive" : "default"} onClick={pending.approve}>{view.confirmLabel ?? "确认"}</Button>
        </div>
      </section>
    );
  }
  return (
    <div className="grid gap-1 text-sm text-foreground">
      <p>{waiting ? (running ? "等待确认" : "已停止") : messageFromToolResult(result)}</p>
      {isRecord(data) && <ToolResultLink result={data} />}
    </div>
  );
}
