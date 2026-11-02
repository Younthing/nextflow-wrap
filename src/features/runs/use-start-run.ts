"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { LaunchConfig } from "@/features/project/launch";
import type { GeneratedProject } from "@/features/project/generate";
import type { WorkflowDoc } from "@/features/workflow/types";
import { launchRequest } from "./launch-request";
import { useLaunchRun } from "./queries";
import { rememberLaunchConfig } from "./saved-launch";

/** Submit a run, keep its settings for the next one-click run, and open its page. */
export function useStartRun() {
  const router = useRouter();
  const launch = useLaunchRun();
  const { mutate } = launch;
  const start = React.useCallback(
    (
      {
        doc,
        project,
        config,
        resumeFrom,
      }: { doc: WorkflowDoc; project: GeneratedProject; config: LaunchConfig; resumeFrom?: string },
      onLaunched?: () => void,
    ) => {
      rememberLaunchConfig(doc.id, config);
      mutate(launchRequest(doc, project, config, resumeFrom), {
        onSuccess: (run) => {
          onLaunched?.();
          router.push(`/runs/${run.id}`);
        },
      });
    },
    [mutate, router],
  );
  return { start, pending: launch.isPending, error: launch.error };
}
