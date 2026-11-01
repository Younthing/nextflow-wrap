import { Suspense } from "react";
import type { Metadata } from "next";

import { PanelLoading } from "@/components/ui/panel-notice";
import { NotebookEditorRoute } from "@/features/notebook/components/notebook-editor";

export const metadata: Metadata = { title: "笔记本" };
export const instant = false;

export default function NotebookEditorPage({ params }: PageProps<"/notebooks/[id]">) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <NotebookEditorRoute params={params} />
    </Suspense>
  );
}
