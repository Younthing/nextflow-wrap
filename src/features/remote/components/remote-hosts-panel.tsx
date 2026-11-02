"use client";

import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";
import { useSaveSettings, useSettings } from "@/features/settings/queries";
import { toast } from "@/lib/toast";
import { useTestRemote } from "../queries";
import { RemoteHostsEditor } from "./remote-hosts-editor";

/** Settings tab: the cluster list is part of the settings file, saved without touching the other preferences. */
export function RemoteHostsPanel() {
  const view = useSettings();
  const save = useSaveSettings();
  const test = useTestRemote();
  if (view.isPending) return <PanelLoading className="h-40" />;
  if (view.isError) return <PanelNotice tone="danger" message={view.error.message} className="h-40" />;
  return (
    <RemoteHostsEditor
      key={JSON.stringify(view.data.settings.remotes)}
      hosts={view.data.settings.remotes}
      saving={save.isPending}
      onTest={(host) => test.mutateAsync(host)}
      onSave={(remotes) => save.mutate({ settings: { ...view.data.settings, remotes } }, { onSuccess: () => toast.success("集群设置已保存"), onError: (error) => toast.error(error.message) })}
    />
  );
}
