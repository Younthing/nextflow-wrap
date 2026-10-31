"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFrontendTool, type FrontendToolHandlerContext } from "@copilotkit/react-core/v2";

import { useCancelRun, useResumeRun } from "@/features/runs/queries";
import type { RunDetail } from "@/features/runs/types";
import { useAssistantPanel } from "./assistant-provider";
import { RunConfirmDialog, subscribeAbort, useRunConfirm } from "./run-confirm";
import { RunToolCard } from "./run-tool-card";
import {
  CANCEL_RUN_DESCRIPTION,
  RESUME_RUN_DESCRIPTION,
  cancelBlockers,
  cancelConfirmView,
  clipReason,
  confirmThenRun,
  createConfirmQueue,
  declinedResult,
  resumeBlockers,
  resumeConfirmView,
  runToolParameters,
  type AcceptedRun,
} from "./run-actions";

/**
 * `cancel_run` and `resume_run` for the run on screen. Both wait on one
 * confirm dialog; neither calls its API until the user accepts.
 */
export function RunControlTools({ run }: { run: RunDetail }) {
  const cancel = useCancelRun();
  const resume = useResumeRun();
  const router = useRouter();
  const { setOpen } = useAssistantPanel();
  const confirm = useRunConfirm();
  const live = React.useRef({ run, cancel, resume, router, setOpen, confirm });
  const queue = React.useRef(createConfirmQueue());
  React.useLayoutEffect(() => {
    live.current = { run, cancel, resume, router, setOpen, confirm };
  });

  useFrontendTool({
    name: "cancel_run",
    description: CANCEL_RUN_DESCRIPTION,
    parameters: runToolParameters,
    handler: (args, context) => queue.current(() => cancelRun(args.reason, context, live)),
    render: RunToolCard,
  });

  useFrontendTool({
    name: "resume_run",
    description: RESUME_RUN_DESCRIPTION,
    parameters: runToolParameters,
    handler: (args, context) => queue.current(() => resumeRun(args.reason, context, live)),
    render: RunToolCard,
  });

  return (
    <RunConfirmDialog
      open={confirm.view !== null}
      view={confirm.view}
      busy={confirm.busy}
      onConfirm={confirm.confirm}
      onDismiss={confirm.dismiss}
    />
  );
}

type Live = React.RefObject<{
  run: RunDetail;
  cancel: ReturnType<typeof useCancelRun>;
  resume: ReturnType<typeof useResumeRun>;
  router: ReturnType<typeof useRouter>;
  setOpen: (open: boolean) => void;
  confirm: ReturnType<typeof useRunConfirm>;
}>;

async function cancelRun(reason: unknown, context: FrontendToolHandlerContext | undefined, live: Live) {
  return controlRun(reason, context, live, {
    interruptedMessage: "确认被中断，没有停止。",
    blockers: (run) => cancelBlockers(run),
    view: (run, problems, note) => cancelConfirmView(run.runName, problems, note),
    execute: async (run, current) => {
      const next = await current.cancel.mutateAsync(run.id);
      const message = next.status === "cancelled" ? `已停止 ${next.runName}` : `正在停止 ${next.runName}`;
      return { accepted: true, runId: next.id, runName: next.runName, status: next.status, ...(next.phase ? { phase: next.phase } : {}), message };
    },
  });
}

async function resumeRun(reason: unknown, context: FrontendToolHandlerContext | undefined, live: Live) {
  return controlRun(reason, context, live, {
    interruptedMessage: "确认被中断，没有恢复。",
    blockers: (run) => resumeBlockers(run),
    view: (run, problems, note) => resumeConfirmView(run.runName, problems, note),
    execute: async (run, current) => {
      const next = await current.resume.mutateAsync(run.id);
      window.setTimeout(() => current.router.push(`/runs/${next.id}`), 0);
      return {
        accepted: true,
        runId: next.id,
        runName: next.runName,
        status: next.status,
        resumedFrom: run.id,
        message: `已恢复，新运行是 ${next.runName}`,
      };
    },
  });
}

async function controlRun(
  reason: unknown,
  context: FrontendToolHandlerContext | undefined,
  live: Live,
  action: {
    interruptedMessage: string;
    blockers: (run: RunDetail) => string[];
    view: (run: RunDetail, problems: string[], reason?: string) => ReturnType<typeof cancelConfirmView>;
    execute: (run: RunDetail, current: NonNullable<Live["current"]>) => Promise<AcceptedRun>;
  },
) {
  if (context?.isReplay) return declinedResult("页面恢复了未完成的确认，没有再次执行。请再说一次。");
  const current = live.current;
  if (!current) return declinedResult("确认对话框不可用，没有执行。");
  if (context?.signal?.aborted) return declinedResult(action.interruptedMessage);
  current.setOpen(true);
  const opened = current.run;
  const problems = action.blockers(opened);
  const stopAbort = subscribeAbort(context?.signal, () => current.confirm.dismiss());
  try {
    return await confirmThenRun({
      isReplay: false,
      aborted: () => context?.signal?.aborted === true,
      ask: (view) => current.confirm.ask(view),
      close: () => current.confirm.close(),
      view: action.view(opened, problems, clipReason(reason)),
      problems: () => {
        const latest = live.current?.run;
        if (!latest || latest.id !== opened.id) return ["当前页面已经不是这次运行，没有执行。"];
        return action.blockers(latest);
      },
      execute: () => {
        const latest = live.current;
        if (!latest || latest.run.id !== opened.id) throw new Error("当前页面已经不是这次运行，没有执行。");
        return action.execute(latest.run, latest);
      },
      interruptedMessage: action.interruptedMessage,
    });
  } finally {
    stopAbort();
  }
}
