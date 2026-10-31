"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useFrontendTool, type FrontendToolHandlerContext } from "@copilotkit/react-core/v2";

import { api } from "@/lib/api";
import type { HealthStatus } from "@/lib/api-types";
import { selectIsDirty, useEditorStore } from "@/features/editor/store";
import type { ModuleIndex } from "@/features/workflow/catalog";
import { indexModules } from "@/features/workflow/catalog";
import type { ModuleCatalog } from "@/features/workflow/types";
import { useLaunchRun } from "@/features/runs/queries";
import { readLaunchConfig, rememberLaunchConfig } from "@/features/runs/saved-launch";
import { useSaveWorkflow } from "@/features/workflow/queries";
import { useAssistantPanel } from "./assistant-provider";
import { RunConfirmDialog, subscribeAbort, useRunConfirm } from "./run-confirm";
import { RunToolCard } from "./run-tool-card";
import {
  START_RUN_DESCRIPTION,
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
  const launch = useLaunchRun();
  const save = useSaveWorkflow();
  const router = useRouter();
  const qc = useQueryClient();
  const { setOpen } = useAssistantPanel();
  const confirm = useRunConfirm();
  const live = React.useRef({ launch, save, router, qc, setOpen, confirm });
  const queue = React.useRef(createConfirmQueue());
  React.useLayoutEffect(() => {
    live.current = { launch, save, router, qc, setOpen, confirm };
  });

  useFrontendTool({
    name: "start_run",
    description: START_RUN_DESCRIPTION,
    parameters: runToolParameters,
    handler: (args, context) => queue.current(() => startRun(args.reason, context, live)),
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
    launch: ReturnType<typeof useLaunchRun>;
    save: ReturnType<typeof useSaveWorkflow>;
    router: ReturnType<typeof useRouter>;
    qc: ReturnType<typeof useQueryClient>;
    setOpen: (open: boolean) => void;
    confirm: ReturnType<typeof useRunConfirm>;
  }>,
) {
  if (context?.isReplay) return declinedResult("页面恢复了未完成的确认，没有再次执行。请再说一次。");
  const current = live.current;
  if (!current) return declinedResult("确认对话框不可用，没有启动。");
  if (context?.signal?.aborted) return declinedResult("确认被中断，没有启动。");
  current.setOpen(true);
  const stopAbort = subscribeAbort(context?.signal, () => current.confirm.dismiss());
  try {
    const state = useEditorStore.getState();
    let saveError: string | undefined;
    if (state.docId && selectIsDirty(state)) {
      const saved = await ensureWorkflowSaved((doc) => current.save.mutateAsync(doc));
      if ("error" in saved) saveError = saved.error;
    }

    const health = await loadHealth(current.qc);
    const catalog = await loadCatalog(current.qc);
    let plan = snapshot(health, catalog);
    if (saveError) plan = { ...plan, problems: [...plan.problems, saveError], request: null };
    const shown = plan;

    const note = clipReason(reason);
    return await confirmThenRun({
      isReplay: false,
      aborted: () => context?.signal?.aborted === true,
      ask: (view) => current.confirm.ask(view),
      close: () => current.confirm.close(),
      view: startConfirmView(plan, note),
      problems: () => {
        const fresh = snapshot(health, catalog);
        if (startPlanStamp(fresh) !== startPlanStamp(shown)) return ["确认时流程或启动设置已变化，没有启动。请再试一次。"];
        return fresh.problems;
      },
      execute: async () => {
        const latest = useEditorStore.getState();
        if (latest.docId && selectIsDirty(latest)) {
          const saved = await ensureWorkflowSaved((doc) => current.save.mutateAsync(doc));
          if ("error" in saved) throw new Error(saved.error);
        }
        const fresh = snapshot(health, catalog);
        if (startPlanStamp(fresh) !== startPlanStamp(shown) || !fresh.request) {
          throw new Error("确认时流程或启动设置已变化，没有启动。");
        }
        rememberLaunchConfig(fresh.workflow.id, fresh.launch);
        const run = await current.launch.mutateAsync(fresh.request);
        window.setTimeout(() => current.router.push(`/runs/${run.id}`), 0);
        return { accepted: true, runId: run.id, runName: run.runName, status: run.status, message: `已启动 ${run.runName}` };
      },
      interruptedMessage: "确认被中断，没有启动。",
    });
  } finally {
    stopAbort();
  }
}

function snapshot(
  health: HealthStatus | undefined,
  catalog: { index: ModuleIndex; gitSha: string; error?: string },
): StartRunPlan {
  const state = useEditorStore.getState();
  return prepareStartRun({
    docId: state.docId,
    doc: state.toDoc(),
    index: catalog.index,
    modulesSha: catalog.gitSha,
    config: readLaunchConfig(state.docId),
    real: !!health && !health.mocked,
    runnerReady: !!health?.runnerReady,
    diagnostics: health?.diagnostics,
    catalogError: catalog.error,
  });
}

async function loadHealth(qc: ReturnType<typeof useQueryClient>): Promise<HealthStatus | undefined> {
  try {
    return await qc.fetchQuery({ queryKey: ["health"], queryFn: () => api<HealthStatus>("/health") });
  } catch {
    return undefined;
  }
}

async function loadCatalog(qc: ReturnType<typeof useQueryClient>): Promise<{ index: ModuleIndex; gitSha: string; error?: string }> {
  const stored = useEditorStore.getState().index;
  const cached = qc.getQueryData<ModuleCatalog>(["modules"]);
  if (stored.size && cached?.gitSha) return { index: stored, gitSha: cached.gitSha };
  try {
    const raw = cached ?? await qc.fetchQuery({
      queryKey: ["modules"],
      queryFn: () => api<ModuleCatalog>("/modules"),
      staleTime: Infinity,
    });
    if (!raw) return { index: new Map(), gitSha: "", error: "模块库加载失败" };
    return { index: stored.size ? stored : indexModules(raw.modules), gitSha: raw.gitSha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { index: new Map(), gitSha: "", error: `模块库加载失败：${message}` };
  }
}
