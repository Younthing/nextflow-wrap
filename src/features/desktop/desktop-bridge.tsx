"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { finishedSince, statusMap, type RunNotice } from "@/features/runs/notifications";
import { isActive, useRuns } from "@/features/runs/queries";
import type { RunStatus } from "@/features/runs/types";
import { useSettings } from "@/features/settings/queries";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";

function announce(notice: RunNotice, open: (runId: string) => void) {
  const bridge = desktop();
  if (bridge) { bridge.notify({ title: notice.title, body: notice.body, runId: notice.runId }); return; }
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  if (hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
    const shown = new Notification(notice.title, { body: notice.body, tag: notice.runId });
    shown.onclick = () => { window.focus(); open(notice.runId); };
    return;
  }
  (notice.status === "succeeded" ? toast.success : toast.error)(`${notice.title}（${notice.body}）`);
}

/**
 * Tells the desktop shell how many runs are active, so closing the window keeps the app in the menu bar and
 * quitting asks what to do with them, and announces runs that finish while the app is open (setting
 * “运行完成通知”). Renders nothing.
 */
export function DesktopBridge() {
  const bridge = desktop();
  const router = useRouter();
  const settings = useSettings();
  const notify = settings.data?.settings.notifications.runFinished ?? false;
  const runs = useRuns(undefined, { enabled: Boolean(bridge) || notify, idlePollMs: 15_000 });
  const count = runs.data?.filter((run) => isActive(run.status)).length ?? 0;
  const seen = React.useRef<Map<string, RunStatus> | null>(null);

  React.useEffect(() => { bridge?.setActiveRuns(count); }, [bridge, count]);
  React.useEffect(() => {
    if (!runs.data) return;
    if (seen.current && notify) finishedSince(seen.current, runs.data).forEach((notice) => announce(notice, (id) => router.push(`/runs/${id}`)));
    seen.current = statusMap(runs.data);
  }, [runs.data, notify, router]);
  return null;
}
