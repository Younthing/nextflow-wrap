/** Matches the workflows API name limit in `workflowSchema`. */
export const WORKFLOW_NAME_MAX = 200;

const COPY_SUFFIX = " 副本";

export function duplicateWorkflowName(name: string): string {
  const base = name.trim() || "未命名流程";
  const room = WORKFLOW_NAME_MAX - COPY_SUFFIX.length;
  return `${base.slice(0, Math.max(0, room))}${COPY_SUFFIX}`;
}

export function filterWorkflows<T extends { name: string; description?: string }>(
  workflows: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...workflows];
  return workflows.filter((workflow) => {
    const description = workflow.description?.toLowerCase() ?? "";
    return workflow.name.toLowerCase().includes(needle) || description.includes(needle);
  });
}

export function latestRunByWorkflow<T extends { workflowId: string; submittedAt: string }>(
  runs: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const run of runs) {
    const current = latest.get(run.workflowId);
    if (!current || run.submittedAt > current.submittedAt) latest.set(run.workflowId, run);
  }
  return latest;
}
