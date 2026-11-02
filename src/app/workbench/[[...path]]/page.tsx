import { Suspense } from "react";
import type { Metadata } from "next";

import { PanelLoading } from "@/components/ui/panel-notice";
import { WorkbenchRoute } from "@/features/workbench/components/workbench-route";

export const metadata: Metadata = { title: "工作台" };
export const instant = false;

/** `/workbench` (start), `/workbench/<notebook>` and `/workbench/<notebook>/publish`. */
export default function WorkbenchPage({ params }: PageProps<"/workbench/[[...path]]">) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <WorkbenchRoute params={params} />
    </Suspense>
  );
}
