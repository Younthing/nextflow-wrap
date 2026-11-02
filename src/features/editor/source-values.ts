import type { CanvasValues } from "@/features/notebook/canvas-values";
import { isInputNode } from "@/features/workflow/builtins";
import { socketInputs, widgetInputs } from "@/features/workflow/ports";
import type { ModuleDef, WorkflowNode } from "@/features/workflow/types";

/**
 * What a module node hands to its source notebook: its widget values, and for each
 * socket the paths of linked file or folder input nodes. A socket fed by another
 * module has no file yet, so the notebook keeps its own value for it.
 */
export function sourceValues(
  node: Pick<WorkflowNode, "id" | "data">,
  def: ModuleDef,
  nodes: readonly Pick<WorkflowNode, "id" | "data">[],
  edges: readonly { source: string; target: string; targetHandle?: string | null }[],
): CanvasValues {
  const values: Record<string, string> = {};
  for (const port of widgetInputs(def)) {
    const value = node.data.widgets[port.name];
    if (value === undefined || value === "") continue;
    values[port.name] = String(value);
  }
  const byId = new Map(nodes.map((item) => [item.id, item]));
  for (const port of socketInputs(def)) {
    const paths = edges
      .filter((edge) => edge.target === node.id && edge.targetHandle === `in:${port.name}`)
      .map((edge) => byId.get(edge.source))
      .filter((source) => source && isInputNode(source.data.moduleId))
      .map((source) => String(source!.data.settings?.path ?? "").trim())
      .filter(Boolean);
    if (paths.length) values[port.name] = paths.join(",");
  }
  return { from: node.data.alias, values };
}
