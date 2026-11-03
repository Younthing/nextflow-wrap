"use client";

import { ToolCallStatus } from "@copilotkit/react-core/v2";

import { messageFromToolResult } from "./confirm";

/** Chat note for a confirm-gated tool. The decision itself is the modal, not this card. */
export function ConfirmToolCard({ status, result }: { status: ToolCallStatus; result?: string }) {
  const waiting = status !== ToolCallStatus.Complete;
  return (
    <p className="text-sm text-foreground">
      {waiting ? "等待确认" : messageFromToolResult(result)}
    </p>
  );
}
