import { Suspense } from "react";
import type { Metadata } from "next";

import { PanelLoading } from "@/components/ui/panel-notice";
import { WorkflowEditorRoute } from "@/features/editor/components/workflow-editor";

export const metadata: Metadata = { title: "流程编辑器" };
export const instant = false;

export default function WorkflowEditorPage({ params }: PageProps<"/workflows/[id]">) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <WorkflowEditorRoute params={params} />
    </Suspense>
  );
}
