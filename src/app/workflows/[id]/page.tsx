import { Suspense } from "react";
import type { Metadata } from "next";
import { Loader2 } from "lucide-react";

import { WorkflowEditorRoute } from "@/features/editor/components/workflow-editor";

export const metadata: Metadata = { title: "流程编辑器" };
export const instant = false;

export default function WorkflowEditorPage({ params }: PageProps<"/workflows/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="glass grid size-full place-items-center rounded-xl">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <WorkflowEditorRoute params={params} />
    </Suspense>
  );
}
