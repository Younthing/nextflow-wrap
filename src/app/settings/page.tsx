import type { Metadata } from "next";

import { SettingsPage } from "@/features/settings/components/settings-page";

export const metadata: Metadata = { title: "设置" };
export const instant = false;

export default function Settings() {
  return <SettingsPage />;
}
