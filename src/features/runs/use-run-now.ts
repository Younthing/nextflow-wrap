"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { EDITOR_ACTIONS } from "@/features/editor/commands";
import { useEditorStoreApi } from "@/features/editor/editor-provider";
import { useSettings } from "@/features/settings/queries";
import type { Issue } from "@/features/workflow/validate";
import { useShortcutLabel } from "@/lib/use-action-shortcuts";
import { toast } from "@/lib/toast";
import { effectiveLaunchConfig, generateFor, setupProblems } from "./launch-request";
import { healthQueryOptions } from "./queries";
import { readLaunchConfig } from "./saved-launch";
import { useStartRun } from "./use-start-run";

/**
 * The toolbar's 运行: start with the saved run settings, like ComfyUI's Queue.
 * A node problem is pointed out on the canvas; anything else opens the run settings.
 */
export function useRunNow({
  issues,
  onNodeIssue,
  onNeedsSettings,
}: {
  issues: readonly Issue[];
  onNodeIssue: (nodeId: string) => void;
  onNeedsSettings: (error?: string) => void;
}) {
  const store = useEditorStoreApi();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const saveShortcut = useShortcutLabel(EDITOR_ACTIONS.save.shortcut);
  const startRun = useStartRun();
  const [checking, setChecking] = React.useState(false);

  const runNow = async () => {
    const errors = issues.filter((issue) => issue.level === "error");
    if (errors.length) {
      const first = errors.find((issue) => issue.nodeId) ?? errors[0];
      if (first.nodeId) onNodeIssue(first.nodeId);
      toast.error(errors.length > 1 ? `还有 ${errors.length} 个问题要先处理，第一个：${first.message}` : first.message);
      return;
    }
    setChecking(true);
    try {
      const health = await queryClient.fetchQuery(healthQueryOptions()).catch(() => undefined);
      const state = store.getState();
      const real = !!health && !health.mocked;
      const config = effectiveLaunchConfig(readLaunchConfig(state.docId), settings.data?.settings.remotes, real);
      const doc = state.toDoc();
      const generated = generateFor(doc, state.index, config.registry);
      const problems = setupProblems({ docId: state.docId, saveShortcut, generated, launch: config, health });
      if (!health || problems.length || !generated.project) {
        onNeedsSettings();
        return;
      }
      startRun.start({ doc, project: generated.project, config }, undefined, (error) => onNeedsSettings(error.message));
    } finally {
      setChecking(false);
    }
  };

  return { runNow, pending: checking || startRun.pending };
}
