import { Suspense } from "react";
import type { Metadata } from "next";

import { PanelLoading } from "@/components/ui/panel-notice";
import { RunDetailView } from "@/features/runs/components/run-detail";

export const metadata: Metadata = { title: "运行详情" };
export const instant = false;

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <RunDetailView params={params} />
    </Suspense>
  );
}
