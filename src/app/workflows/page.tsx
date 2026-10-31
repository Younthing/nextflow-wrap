import type { Metadata } from "next";

import { WorkflowLibrary } from "@/features/workflow/components/workflow-library";

export const metadata: Metadata = { title: "流程" };
export const instant = false;

export default function WorkflowsPage() {
  return <WorkflowLibrary />;
}
