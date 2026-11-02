import type { Metadata } from "next";

import { SetupWizard } from "@/features/setup/components/setup-wizard";

export const metadata: Metadata = { title: "运行环境" };
export const instant = false;

export default function SetupPage() {
  return <SetupWizard />;
}
