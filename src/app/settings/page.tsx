import type { Metadata } from "next";

import { SettingsPage } from "@/features/settings/components/settings-page";
import { StoragePanel } from "@/features/storage/components/storage-panel";
import { DiagnosticsPanel } from "@/features/diagnostics/components/diagnostics-panel";

export const metadata: Metadata = { title: "设置" };
export const instant = false;

export default function Settings() {
  return <SettingsPage sections={[{ id: "storage", label: "磁盘", content: <StoragePanel /> }, { id: "diagnostics", label: "诊断", content: <DiagnosticsPanel /> }]} />;
}
