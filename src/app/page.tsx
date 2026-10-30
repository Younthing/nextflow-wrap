import { WorkflowEditor } from "@/features/editor/components/workflow-editor";

// The editor mounts after the browser's API/mock gate, outside the static shell.
export const instant = false;

export default function EditorPage() {
  return <WorkflowEditor />;
}
