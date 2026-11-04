"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { prepareRunControl, type RunControl } from "./assistant-actions";
import { useCancelRun, useResumeRun } from "./queries";
import type { RunDetail } from "./types";

/** Stop and resume for the run on screen, as prepared invocations. Reads the latest `run` at call time. */
export function useRunControl(run: RunDetail) {
  const cancel = useCancelRun().mutateAsync;
  const resume = useResumeRun().mutateAsync;
  const router = useRouter();
  const current = React.useRef(run);
  React.useLayoutEffect(() => {
    current.current = run;
  });
  return React.useMemo(
    () => ({
      prepare: (action: RunControl, reason?: string) =>
        prepareRunControl(
          {
            current: () => current.current,
            cancel,
            resume,
            openRun: (runId) => window.setTimeout(() => router.push(`/runs/${runId}`), 0),
          },
          action,
          reason,
        ),
    }),
    [cancel, resume, router],
  );
}
