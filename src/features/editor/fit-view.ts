import type { FitViewOptions } from "@xyflow/react";

/** Shared by the F / Shift+1 chord and the canvas fit button. */
export function fitViewOptions(nodes: readonly { id: string; selected?: boolean }[]): FitViewOptions {
  const selected = nodes.filter((node) => node.selected);
  return {
    padding: 0.2,
    maxZoom: 1,
    duration: 300,
    ...(selected.length > 0 ? { nodes: selected.map((node) => ({ id: node.id })) } : {}),
  };
}
