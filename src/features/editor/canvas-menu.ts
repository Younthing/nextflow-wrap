import { actionRegistry, isActionEnabled, type Action } from "@/lib/actions";

import { EDITOR_ACTIONS } from "./commands";

/**
 * Canvas right-click menu. The groups follow ComfyUI: clipboard, then
 * selection, then the canvas actions (node search stands in for Add Node,
 * fit view for the canvas fit control). The same list opens on empty canvas
 * and on a node. Commands that do not apply are disabled by their `can*`
 * predicate instead of being omitted.
 *
 * Save, undo, and redo stay on the toolbar. ComfyUI's canvas and node menus
 * do not include them, and this editor already shows them there.
 * Node items such as remove, bypass, and pin are not listed: the registry
 * has no command for them.
 */
const CANVAS_MENU_GROUPS = [
  ["copy", "paste", "duplicate"],
  ["selectAll", "deselect"],
  ["search", "fit"],
] as const satisfies readonly (readonly (keyof typeof EDITOR_ACTIONS)[])[];

export type CanvasMenuItem = {
  type: "item";
  id: string;
  label: string;
  shortcut: NonNullable<Action["shortcut"]>;
  disabled: boolean;
};

export type CanvasMenuEntry = CanvasMenuItem | { type: "separator" };

/** Menu rows for the actions currently registered. An unregistered command stays visible and disabled. */
export function canvasContextMenuItems(actions: readonly Action[]): CanvasMenuEntry[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const entries: CanvasMenuEntry[] = [];
  for (const [index, group] of CANVAS_MENU_GROUPS.entries()) {
    if (index > 0) entries.push({ type: "separator" });
    for (const key of group) {
      const spec = EDITOR_ACTIONS[key];
      const action = byId.get(spec.id);
      entries.push({
        type: "item",
        id: spec.id,
        label: action?.label ?? spec.label,
        shortcut: action?.shortcut ?? spec.shortcut,
        disabled: !action || !isActionEnabled(action),
      });
    }
  }
  return entries;
}

/**
 * Runs the registered command, the same `run` the chord calls.
 * Returns false when the id is missing or its `enabled` predicate is false.
 */
export function runRegisteredAction(
  id: string,
  registry: { get: (id: string) => Action | undefined } = actionRegistry,
): boolean {
  const action = registry.get(id);
  if (!action || !isActionEnabled(action)) return false;
  action.run();
  return true;
}

/**
 * Re-render key for the menu. It changes when a canvas command's `can*`
 * predicate can change: selection, graph size, or the node clipboard.
 */
export function commandMenuEpoch(state: {
  nodes: readonly { selected?: boolean }[];
  edges: readonly { selected?: boolean }[];
  clipboard: { nodes: readonly unknown[] } | null;
}): string {
  let selectedNodes = 0;
  for (const node of state.nodes) if (node.selected) selectedNodes += 1;
  let selectedEdges = 0;
  for (const edge of state.edges) if (edge.selected) selectedEdges += 1;
  return `${state.nodes.length}:${selectedNodes}:${selectedEdges}:${state.clipboard?.nodes.length ?? 0}`;
}

/**
 * ComfyUI selects the node under a right-click when it is not already
 * selected, and leaves a multi-selection alone when it is. Selected links
 * are cleared so copy and duplicate apply to that node.
 */
export function selectionForContextTarget<
  N extends { id: string; selected?: boolean },
  E extends { selected?: boolean },
>(nodes: readonly N[], edges: readonly E[], nodeId: string): { nodes: N[]; edges: E[] } | null {
  const target = nodes.find((node) => node.id === nodeId);
  if (!target || target.selected) return null;
  return {
    nodes: nodes.map((node) => {
      const selected = node.id === nodeId;
      if (Boolean(node.selected) === selected) return node;
      return { ...node, selected };
    }),
    edges: edges.some((edge) => edge.selected)
      ? edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
      : (edges as E[]),
  };
}
