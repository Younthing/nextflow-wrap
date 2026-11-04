"use client";

import * as React from "react";
import type { FrontendToolHandlerContext } from "@copilotkit/react-core/v2";

import { useAssistantPanel } from "./assistant-provider";
import {
  blockedResult,
  confirmThenRun,
  createConfirmQueue,
  declinedResult,
  type AcceptedResult,
  type ConfirmedResult,
  type PreparedInvocation,
} from "./confirm";
import { ConfirmDialog, subscribeAbort, useConfirmDialog } from "./confirm-dialog";

export interface ConfirmedCall<T extends AcceptedResult> {
  /** Declined result when the chat stops the call before or during the dialog. */
  interruptedMessage: string;
  /** VS Code `prepareInvocation`: plan the call. It must not change anything. */
  prepare: () => PreparedInvocation<T> | Promise<PreparedInvocation<T>>;
}

/**
 * The shared confirm gate for a surface's risky tools: one dialog, one queue,
 * replay and abort handling. Surfaces pass the domain's prepared invocation and
 * render `dialog`.
 */
export function useConfirmedTool() {
  const confirm = useConfirmDialog();
  const { setOpen } = useAssistantPanel();
  const live = React.useRef({ confirm, setOpen });
  const [queue] = React.useState(createConfirmQueue);
  React.useLayoutEffect(() => {
    live.current = { confirm, setOpen };
  });

  const invoke = React.useCallback(
    <T extends AcceptedResult>(
      context: FrontendToolHandlerContext | undefined,
      call: ConfirmedCall<T>,
    ): Promise<ConfirmedResult<T>> =>
      queue(async () => {
        if (context?.isReplay) return declinedResult("页面恢复了未完成的确认，没有再次执行。请再说一次。");
        if (context?.signal?.aborted) return declinedResult(call.interruptedMessage);
        const current = live.current;
        current.setOpen(true);
        const stopAbort = subscribeAbort(context?.signal, () => current.confirm.dismiss());
        try {
          let prepared: PreparedInvocation<T>;
          try {
            prepared = await call.prepare();
          } catch (err) {
            return blockedResult([err instanceof Error ? err.message : String(err)]);
          }
          return await confirmThenRun({
            isReplay: false,
            aborted: () => context?.signal?.aborted === true,
            ask: (view) => current.confirm.ask(view),
            close: () => current.confirm.close(),
            view: prepared.view,
            problems: prepared.problems,
            execute: prepared.invoke,
            interruptedMessage: call.interruptedMessage,
          });
        } finally {
          stopAbort();
        }
      }),
    [queue],
  );

  const dialog = (
    <ConfirmDialog
      open={confirm.view !== null}
      view={confirm.view}
      busy={confirm.busy}
      onConfirm={confirm.confirm}
      onDismiss={confirm.dismiss}
    />
  );
  return { invoke, dialog };
}
