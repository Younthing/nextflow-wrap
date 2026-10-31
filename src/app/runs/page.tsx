import type { Metadata } from "next";

import { RunsBrowse } from "@/features/runs/components/runs-browse";

export const metadata: Metadata = { title: "运行记录" };
export const instant = false;

export default function RunsPage() {
  return <RunsBrowse />;
}
