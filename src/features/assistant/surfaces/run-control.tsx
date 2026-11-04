"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";

import type { RunDetail } from "@/features/runs/types";
import { useRunControl } from "@/features/runs/use-run-control";
import { clipReason, confirmReasonParameters } from "../confirm";
import { useConfirmedTool } from "../confirmed-tool";
import { ConfirmToolCard } from "../confirm-tool-card";
import { moduleTool } from "../modules/contract";
import { runDiagnosticsModule } from "../modules/run-diagnostics";

/**
 * `cancel_run` and `resume_run` for the run on screen. Both wait on one
 * confirm dialog; neither calls its API until the user accepts.
 */
export function RunControlTools({ run }: { run: RunDetail }) {
  const control = useRunControl(run);
  const { invoke, dialog } = useConfirmedTool();

  useFrontendTool({
    name: moduleTool(runDiagnosticsModule, "cancel_run").name,
    description: moduleTool(runDiagnosticsModule, "cancel_run").description,
    parameters: confirmReasonParameters,
    handler: (args, context) =>
      invoke(context, {
        interruptedMessage: "确认被中断，没有停止。",
        prepare: () => control.prepare("cancel", clipReason(args.reason)),
      }),
    render: ConfirmToolCard,
  }, [control, invoke]);

  useFrontendTool({
    name: moduleTool(runDiagnosticsModule, "resume_run").name,
    description: moduleTool(runDiagnosticsModule, "resume_run").description,
    parameters: confirmReasonParameters,
    handler: (args, context) =>
      invoke(context, {
        interruptedMessage: "确认被中断，没有恢复。",
        prepare: () => control.prepare("resume", clipReason(args.reason)),
      }),
    render: ConfirmToolCard,
  }, [control, invoke]);

  return dialog;
}
