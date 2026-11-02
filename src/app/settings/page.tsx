import type { Metadata } from "next";

import { SettingsPage } from "@/features/settings/components/settings-page";
import { StoragePanel } from "@/features/storage/components/storage-panel";
import { DiagnosticsPanel } from "@/features/diagnostics/components/diagnostics-panel";
import { RemoteHostsPanel } from "@/features/remote/components/remote-hosts-panel";

export const metadata: Metadata = { title: "设置" };
export const instant = false;

export default function Settings() {
  return <SettingsPage sections={[{ id: "remotes", label: "远程集群", content: <RemoteHostsPanel /> }, { id: "storage", label: "磁盘", content: <StoragePanel /> }, { id: "diagnostics", label: "诊断", content: <DiagnosticsPanel /> }]} />;
}
