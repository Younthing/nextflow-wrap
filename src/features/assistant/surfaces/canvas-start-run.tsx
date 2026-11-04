"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";

import { useStartRun } from "@/features/editor/use-start-run";
import { clipReason, confirmReasonParameters } from "../confirm";
import { useConfirmedTool } from "../confirmed-tool";
import { ConfirmToolCard } from "../confirm-tool-card";
import { canvasEditModule } from "../modules/canvas-edit";
import { moduleTool } from "../modules/contract";

/**
 * `start_run` for the editor. The editor's start-run service saves and plans;
 * nothing launches until the confirm dialog is accepted, and a replayed call
 * never launches.
 */
export function StartRunTool() {
  const startRun = useStartRun();
  const { invoke, dialog } = useConfirmedTool();

  useFrontendTool({
    name: moduleTool(canvasEditModule, "start_run").name,
    description: moduleTool(canvasEditModule, "start_run").description,
    parameters: confirmReasonParameters,
    handler: (args, context) =>
      invoke(context, {
        interruptedMessage: "确认被中断，没有启动。",
        prepare: () => startRun.prepare(clipReason(args.reason)),
      }),
    render: ConfirmToolCard,
  }, [startRun, invoke]);

  return dialog;
}
