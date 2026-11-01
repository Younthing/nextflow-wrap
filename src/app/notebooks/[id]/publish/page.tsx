import { Suspense } from "react";
import type { Metadata } from "next";

import { PanelLoading } from "@/components/ui/panel-notice";
import { PublishWizardRoute } from "@/features/notebook/components/publish-wizard";

export const metadata: Metadata = { title: "发布为模块" };
export const instant = false;

export default function PublishNotebookPage({ params }: PageProps<"/notebooks/[id]/publish">) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <PublishWizardRoute params={params} />
    </Suspense>
  );
}
