"use client";

import * as React from "react";

import { isActive, useRuns } from "@/features/runs/queries";
import { desktop } from "@/lib/desktop";

/**
 * Tells the desktop shell how many runs are active, so closing the window keeps the app in the menu bar and
 * quitting asks what to do with them. Renders nothing; does nothing in a browser.
 */
export function DesktopBridge() {
  const bridge = desktop();
  const runs = useRuns(undefined, { enabled: Boolean(bridge), idlePollMs: 15_000 });
  const count = runs.data?.filter((run) => isActive(run.status)).length ?? 0;
  React.useEffect(() => { bridge?.setActiveRuns(count); }, [bridge, count]);
  return null;
}
