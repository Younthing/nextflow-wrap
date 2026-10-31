import { describe, expect, it } from "vitest";

import type { WorkflowNodeData } from "@/features/workflow/types";
import { MODULE_CARD_WIDTH, PASTE_GAP, materializeClipboard, selectionClipboard } from "./clipboard";

function data(alias: string, extra: Partial<WorkflowNodeData> = {}): WorkflowNodeData {
  return { moduleId: "builtin/samplesheet", alias, widgets: {}, config: {}, ...extra };
}

const nodes = [
  { id: "n1", position: { x: 10, y: 20 }, selected: true, data: data("SAMPLESHEET", { widgets: { note: "a" } }) },
  { id: "n2", position: { x: 300, y: 40 }, selected: true, data: data("SAMPLESHEET_2") },
  { id: "n3", position: { x: 600, y: 60 }, selected: false, data: data("SAMPLESHEET_3") },
];

const edges = [
  { id: "e12", source: "n1", target: "n2", sourceHandle: "out:reads", targetHandle: "in:reads" },
  { id: "e23", source: "n2", target: "n3", sourceHandle: "out:reads", targetHandle: "in:reads" },
];

describe("selection clipboard", () => {
  it("keeps edges inside the selection and drops edges that leave it", () => {
    const clip = selectionClipboard(nodes, edges);
    expect(clip?.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(clip?.edges).toEqual([
      { id: "e12", source: "n1", target: "n2", sourceHandle: "out:reads", targetHandle: "in:reads" },
    ]);
    expect(selectionClipboard(nodes.map((node) => ({ ...node, selected: false })), edges)).toBeNull();
  });

  it("offsets copies past the source card and remaps internal edges", () => {
    expect(PASTE_GAP).toBeGreaterThan(MODULE_CARD_WIDTH);
    const clip = selectionClipboard(nodes, edges);
    expect(clip).not.toBeNull();
    if (!clip) return;

    const created = materializeClipboard(clip, nodes, new Map(), 1, {});
    expect(created.nodes).toHaveLength(2);
    expect(created.edges).toHaveLength(1);
    clip.nodes.forEach((source, index) => {
      const copy = created.nodes[index];
      expect(copy?.id).not.toBe(source.id);
      expect(copy?.position.x).toBe(source.position.x + PASTE_GAP);
      expect(copy?.position.y).toBe(source.position.y + PASTE_GAP);
      expect(copy!.position.x - source.position.x).toBeGreaterThan(MODULE_CARD_WIDTH);
      expect(copy!.position.y - source.position.y).toBeGreaterThan(MODULE_CARD_WIDTH);
    });
    const [first, second] = created.nodes;
    expect(created.edges[0]).toMatchObject({
      source: first?.id,
      target: second?.id,
      sourceHandle: "out:reads",
      targetHandle: "in:reads",
    });
    expect(created.edges[0]?.id).not.toBe("e12");

    const again = materializeClipboard(clip, [...nodes, ...created.nodes], new Map(), 2, {});
    expect(again.nodes[0]?.position).toEqual({ x: 10 + PASTE_GAP * 2, y: 20 + PASTE_GAP * 2 });
    expect(again.edges).toHaveLength(1);
    expect(again.edges[0]?.source).toBe(again.nodes[0]?.id);
    expect(again.edges[0]?.target).toBe(again.nodes[1]?.id);
  });
});
