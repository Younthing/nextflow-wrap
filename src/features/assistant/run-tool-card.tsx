"use client";

import { ToolCallStatus } from "@copilotkit/react-core/v2";

import { messageFromToolResult } from "./run-actions";

/** Chat note for a run tool. The decision itself is the modal, not this card. */
export function RunToolCard({ status, result }: { status: ToolCallStatus; result?: string }) {
  const waiting = status !== ToolCallStatus.Complete;
  return (
    <p className="text-sm text-foreground">
      {waiting ? "等待你在对话框里确认。在你接受或拒绝之前不会执行。" : messageFromToolResult(result)}
    </p>
  );
}
