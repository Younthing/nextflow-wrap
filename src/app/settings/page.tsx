import type { Metadata } from "next";

import { SettingsPage } from "@/features/settings/components/settings-page";
import { StoragePanel } from "@/features/storage/components/storage-panel";

export const metadata: Metadata = { title: "设置" };
export const instant = false;

export default function Settings() {
  return <SettingsPage sections={[{ id: "storage", label: "磁盘", content: <StoragePanel /> }]} />;
}
