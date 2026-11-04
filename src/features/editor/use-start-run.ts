"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { loadHealth, useLaunchRun } from "@/features/runs/queries";
import { readLaunchConfig, rememberLaunchConfig } from "@/features/runs/saved-launch";
import { loadModuleIndex, useSaveWorkflow } from "@/features/workflow/queries";
import { prepareStartRunInvocation } from "./assistant-start-run";
import { useEditorStoreApi } from "./editor-provider";

/**
 * The open editor's `start_run` service: the editor session, its save queue,
 * the saved run settings, and the launch API behind one `prepare` call.
 */
export function useStartRun() {
  const store = useEditorStoreApi();
  const launch = useLaunchRun().mutateAsync;
  const save = useSaveWorkflow(store).mutateAsync;
  const router = useRouter();
  const qc = useQueryClient();
  return React.useMemo(
    () => ({
      prepare: (reason?: string) =>
        prepareStartRunInvocation(
          {
            store,
            saveWorkflow: save,
            launch,
            health: () => loadHealth(qc),
            catalog: (stored) => loadModuleIndex(qc, stored),
            readConfig: readLaunchConfig,
            rememberConfig: rememberLaunchConfig,
            // After the tool result is returned, so the chat records it before the page changes.
            openRun: (runId) => window.setTimeout(() => router.push(`/runs/${runId}`), 0),
          },
          reason,
        ),
    }),
    [store, save, launch, router, qc],
  );
}
