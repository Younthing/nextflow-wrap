import type { EditorState } from "./store";
import { validateWorkflow, type Issue } from "@/features/workflow/validate";

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

/** Validation issues grouped by node, so each card can show its own. */
export function groupIssuesByNode(issues: readonly Issue[]): Map<string, Issue[]> {
  const byNode = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    const list = byNode.get(issue.nodeId) ?? [];
    list.push(issue);
    byNode.set(issue.nodeId, list);
  }
  return byNode;
}
