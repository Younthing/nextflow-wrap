import type { EditorState } from "./store";
import { validateWorkflow } from "@/features/workflow/validate";

export function editorIssues(
  state: Pick<EditorState, "nodes" | "edges" | "params" | "index">,
) {
  if (!state.index.size) return [];
  return validateWorkflow(
    state.nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
    state.edges.map((e) => ({
      ...e,
      sourceHandle: e.sourceHandle ?? "",
      targetHandle: e.targetHandle ?? "",
    })),
    state.params,
    state.index,
  );
}
