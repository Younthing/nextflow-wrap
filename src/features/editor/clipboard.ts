import { resolveNodeDef, type ModuleIndex } from "@/features/workflow/catalog";
import { newId, uniqueAlias } from "@/features/workflow/nodes";
import type { WorkflowNodeData } from "@/features/workflow/types";

/** Distance from the source nodes to each paste or duplicate, in flow units. */
export const PASTE_GAP = 40;

export type ClipboardNode = {
  id: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
};

export type ClipboardEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** Selected nodes plus links whose two ends are both in that selection. */
export type NodeClipboard = {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
};

type GraphNode = ClipboardNode & { selected?: boolean };

function cloneData(data: WorkflowNodeData): WorkflowNodeData {
  return structuredClone(data);
}

function aliasStem(alias: string, fallback: string): string {
  const stem = alias.replace(/_\d+$/, "");
  return stem || fallback;
}

/**
 * Copies the selection the way ComfyUI's plain paste does: links that leave
 * the selection are dropped. Returns null when nothing is selected.
 */
export function selectionClipboard(
  nodes: readonly GraphNode[],
  edges: readonly ClipboardEdge[],
): NodeClipboard | null {
  const selected = nodes.filter((node) => node.selected);
  if (selected.length === 0) return null;
  const ids = new Set(selected.map((node) => node.id));
  return {
    nodes: selected.map((node) => ({
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      data: cloneData(node.data),
    })),
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
  };
}

/**
 * New ids, unique process aliases, and a stair-step offset.
 * `step` is 1 for the first paste or a duplicate, then 2, 3, …
 */
export function materializeClipboard(
  clipboard: NodeClipboard,
  existing: readonly { data: WorkflowNodeData }[],
  index: ModuleIndex,
  step: number,
): { nodes: ClipboardNode[]; edges: ClipboardEdge[] } {
  const offset = PASTE_GAP * step;
  const takenAliases = new Set(existing.map((node) => node.data.alias));
  const takenParams = new Set(
    existing.flatMap((node) => {
      const param = node.data.settings?.param;
      return typeof param === "string" && param ? [param] : [];
    }),
  );
  const idMap = new Map<string, string>();

  const nodes = clipboard.nodes.map((node) => {
    const id = newId("n");
    idMap.set(node.id, id);
    const data = cloneData(node.data);
    const def = resolveNodeDef(index, data);
    data.alias = uniqueAlias(aliasStem(data.alias, def?.process ?? "NODE"), takenAliases);
    takenAliases.add(data.alias);
    const param = data.settings?.param;
    if (typeof param === "string" && param) {
      const next = uniqueAlias(aliasStem(param, param), takenParams);
      data.settings = { ...data.settings, param: next };
      takenParams.add(next);
    }
    return {
      id,
      position: { x: node.position.x + offset, y: node.position.y + offset },
      data,
    };
  });

  const edges = clipboard.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) return [];
    return [
      {
        id: newId("e"),
        source,
        target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      },
    ];
  });

  return { nodes, edges };
}
