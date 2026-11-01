"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFrontendTool,
  type FrontendToolHandlerContext,
} from "@copilotkit/react-core/v2";

import type { HealthStatus } from "@/lib/api-types";
import { selectIsDirty, type EditorStore } from "@/features/editor/store";
import { useEditorStoreApi } from "@/features/editor/editor-provider";
import type { ModuleIndex } from "@/features/workflow/catalog";
import { useLaunchRun } from "@/features/runs/queries";
import {
  readLaunchConfig,
  rememberLaunchConfig,
} from "@/features/runs/saved-launch";
import { useSaveWorkflow } from "@/features/workflow/queries";
import { loadHealth, loadCatalog } from "./queries";
import { useAssistantPanel } from "./assistant-provider";
import { canvasEditModule } from "./modules/canvas-edit";
import { moduleTool } from "./modules/contract";
import { RunConfirmDialog, subscribeAbort, useRunConfirm } from "./run-confirm";
import { RunToolCard } from "./run-tool-card";
import {
  clipReason,
  confirmThenRun,
  createConfirmQueue,
  declinedResult,
  ensureWorkflowSaved,
  prepareStartRun,
  runToolParameters,
  startConfirmView,
  startPlanStamp,
  type StartRunPlan,
} from "./run-actions";

/**
 * `start_run` for the editor. The handler does not call the launch API until
 * the confirm dialog is accepted, and a replayed tool call never launches.
 */
export function StartRunTool() {
  const store = useEditorStoreApi();
  const launch = useLaunchRun();
  const save = useSaveWorkflow(store);
  const router = useRouter();
  const qc = useQueryClient();
  const { setOpen } = useAssistantPanel();
  const confirm = useRunConfirm();
  const live = React.useRef({
    launch,
    save,
    router,
    qc,
    setOpen,
    confirm,
    store,
  });
  const queue = React.useRef(createConfirmQueue());
  React.useLayoutEffect(() => {
    live.current = { launch, save, router, qc, setOpen, confirm, store };
  });

  useFrontendTool({
    name: moduleTool(canvasEditModule, "start_run").name,
    description: moduleTool(canvasEditModule, "start_run").description,
    parameters: runToolParameters,
    handler: (args, context) =>
      queue.current(() => startRun(args.reason, context, live)),
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

async function startRun(
  reason: unknown,
  context: FrontendToolHandlerContext | undefined,
  live: React.RefObject<{
    store: EditorStore;
    launch: ReturnType<typeof useLaunchRun>;
    save: ReturnType<typeof useSaveWorkflow>;
    router: ReturnType<typeof useRouter>;
    qc: ReturnType<typeof useQueryClient>;
    setOpen: (open: boolean) => void;
    confirm: ReturnType<typeof useRunConfirm>;
  }>,
) {
  if (context?.isReplay)
    return declinedResult("页面恢复了未完成的确认，没有再次执行。请再说一次。");
  const current = live.current;
  if (!current) return declinedResult("确认对话框不可用，没有启动。");
  if (context?.signal?.aborted) return declinedResult("确认被中断，没有启动。");
  const { store } = current;
  current.setOpen(true);
  const stopAbort = subscribeAbort(context?.signal, () =>
    current.confirm.dismiss(),
  );
  try {
    const state = store.getState();
    let saveError: string | undefined;
    if (state.docId && selectIsDirty(state)) {
      const saved = await ensureWorkflowSaved(
        (doc) => current.save.mutateAsync(doc),
        store,
      );
      if ("error" in saved) saveError = saved.error;
    }

    const health = await loadHealth(current.qc);
    const catalog = await loadCatalog(current.qc, store.getState().index);
    let plan = snapshot(health, catalog, store);
    if (saveError)
      plan = {
        ...plan,
        problems: [...plan.problems, saveError],
        request: null,
      };
    const shown = plan;

    const note = clipReason(reason);
    return await confirmThenRun({
      isReplay: false,
      aborted: () => context?.signal?.aborted === true,
      ask: (view) => current.confirm.ask(view),
      close: () => current.confirm.close(),
      view: startConfirmView(plan, note),
      problems: () => {
        const fresh = snapshot(health, catalog, store);
        if (startPlanStamp(fresh) !== startPlanStamp(shown))
          return ["确认时流程或启动设置已变化，没有启动。请再试一次。"];
        return fresh.problems;
      },
      execute: async () => {
        const latest = store.getState();
        if (latest.docId && selectIsDirty(latest)) {
          const saved = await ensureWorkflowSaved(
            (doc) => current.save.mutateAsync(doc),
            store,
          );
          if ("error" in saved) throw new Error(saved.error);
        }
        const fresh = snapshot(health, catalog, store);
        if (startPlanStamp(fresh) !== startPlanStamp(shown) || !fresh.request) {
          throw new Error("确认时流程或启动设置已变化，没有启动。");
        }
        rememberLaunchConfig(fresh.workflow.id, fresh.launch);
        const run = await current.launch.mutateAsync(fresh.request);
        window.setTimeout(() => current.router.push(`/runs/${run.id}`), 0);
        return {
          accepted: true,
          runId: run.id,
          runName: run.runName,
          status: run.status,
          message: `已启动 ${run.runName}`,
        };
      },
      interruptedMessage: "确认被中断，没有启动。",
    });
  } finally {
    stopAbort();
  }
}

function snapshot(
  health: HealthStatus | undefined,
  catalog: { index: ModuleIndex; error?: string },
  store: EditorStore,
): StartRunPlan {
  const state = store.getState();
  return prepareStartRun({
    docId: state.docId,
    doc: state.toDoc(),
    index: catalog.index,
    config: readLaunchConfig(state.docId),
    real: !!health && !health.mocked,
    runnerReady: !!health?.runnerReady,
    diagnostics: health?.diagnostics,
    catalogError: catalog.error,
  });
}
