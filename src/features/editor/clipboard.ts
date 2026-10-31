import { resolveNodeDef, type ModuleIndex } from "@/features/workflow/catalog";
import { newId, uniqueAlias } from "@/features/workflow/nodes";
import type { PipelineParams, WorkflowNodeData } from "@/features/workflow/types";

/**
 * Module cards are `w-64` (16rem = 256px). The paste step has to clear that
 * width: a shorter step drops the copy on the original, and the edges between
 * the copied nodes sit on the source edges, so the canvas looks unchanged.
 */
export const MODULE_CARD_WIDTH = 256;

/** Distance from the source nodes to each paste or duplicate, in flow units. */
export const PASTE_GAP = MODULE_CARD_WIDTH + 64;

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

/**
 * Selected nodes, links whose two ends are both in that selection, and the
 * reference-param values those nodes point at. The values stay with the
 * clipboard so a paste into another workflow can keep the paths.
 */
export type NodeClipboard = {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
  params: PipelineParams;
};

type GraphNode = ClipboardNode & { selected?: boolean };

function cloneData(data: WorkflowNodeData): WorkflowNodeData {
  return structuredClone(data);
}

function aliasStem(alias: string, fallback: string): string {
  const stem = alias.replace(/_\d+$/, "");
  return stem || fallback;
}

function paramName(data: WorkflowNodeData): string | undefined {
  const param = data.settings?.param;
  return typeof param === "string" && param ? param : undefined;
}

/** Param values named by the copied nodes, keyed by the name still on the node. */
function captureParams(nodes: readonly { data: WorkflowNodeData }[], params: PipelineParams): PipelineParams {
  const captured: PipelineParams = {};
  for (const node of nodes) {
    const name = paramName(node.data);
    if (!name || !(name in params)) continue;
    captured[name] = params[name];
  }
  return captured;
}

/**
 * Copies the selection the way ComfyUI's plain paste does: links that leave
 * the selection are dropped. Returns null when nothing is selected.
 * `params` is the workflow's param map; reference paths are copied by value.
 */
export function selectionClipboard(
  nodes: readonly GraphNode[],
  edges: readonly ClipboardEdge[],
  params: PipelineParams = {},
): NodeClipboard | null {
  const selected = nodes.filter((node) => node.selected);
  if (selected.length === 0) return null;
  const ids = new Set(selected.map((node) => node.id));
  const copied = selected.map((node) => ({
    id: node.id,
    position: { x: node.position.x, y: node.position.y },
    data: cloneData(node.data),
  }));
  return {
    nodes: copied,
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    params: captureParams(copied, params),
  };
}

/**
 * Parameter names already in use: every destination workflow key, plus names
 * on existing nodes. Keys such as `input` belong to the pipeline even when
 * no reference node points at them.
 */
function takenParamNames(
  existing: readonly { data: WorkflowNodeData }[],
  workflowParams: PipelineParams,
): Set<string> {
  const taken = new Set(Object.keys(workflowParams));
  for (const node of existing) {
    const name = paramName(node.data);
    if (name) taken.add(name);
  }
  return taken;
}

/**
 * New ids, unique process aliases, and a stair-step offset.
 * Reference param names are remapped against node settings and existing
 * workflow parameter keys. `params` holds their values under those new names.
 * `step` is 1 for the first paste or a duplicate, then 2, 3, …
 */
export function materializeClipboard(
  clipboard: NodeClipboard,
  existing: readonly { data: WorkflowNodeData }[],
  index: ModuleIndex,
  step: number,
  workflowParams: PipelineParams,
): { nodes: ClipboardNode[]; edges: ClipboardEdge[]; params: PipelineParams } {
  const offset = PASTE_GAP * step;
  const takenAliases = new Set(existing.map((node) => node.data.alias));
  const takenParams = takenParamNames(existing, workflowParams);
  const idMap = new Map<string, string>();
  const params: PipelineParams = {};

  const nodes = clipboard.nodes.map((node) => {
    const id = newId("n");
    idMap.set(node.id, id);
    const data = cloneData(node.data);
    const def = resolveNodeDef(index, data);
    data.alias = uniqueAlias(aliasStem(data.alias, def?.process ?? "NODE"), takenAliases);
    takenAliases.add(data.alias);
    const param = paramName(data);
    if (param) {
      const next = uniqueAlias(aliasStem(param, param), takenParams);
      data.settings = { ...data.settings, param: next };
      takenParams.add(next);
      if (param in clipboard.params) params[next] = clipboard.params[param];
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

  return { nodes, edges, params };
}
