import { beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_MODULES, REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowNodeData } from "@/features/workflow/types";
import { PASTE_GAP } from "./clipboard";
import { useEditorStore, type FlowEdge, type FlowNode } from "./store";

function node(
  id: string,
  alias: string,
  position: { x: number; y: number },
  selected: boolean,
  data: Partial<WorkflowNodeData> = {},
): FlowNode {
  return {
    id,
    type: "module",
    position,
    selected,
    data: {
      moduleId: SAMPLESHEET_ID,
      alias,
      widgets: {},
      config: {},
      ...data,
    },
  };
}

function seedSelection() {
  useEditorStore.getState().setIndex(indexModules(BUILTIN_MODULES));
  useEditorStore.setState({
    nodes: [
      node("n1", "SAMPLESHEET", { x: 10, y: 20 }, true, { widgets: { note: "a" } }),
      node("n2", "SAMPLESHEET_2", { x: 300, y: 40 }, true),
      node("n3", "SAMPLESHEET_3", { x: 600, y: 60 }, false),
    ],
    edges: [
      { id: "e12", source: "n1", target: "n2", sourceHandle: "out:reads", targetHandle: "in:reads" },
      { id: "e23", source: "n2", target: "n3", sourceHandle: "out:reads", targetHandle: "in:reads" },
    ] satisfies FlowEdge[],
  });
}

describe("editor store history", () => {
  beforeEach(() => {
    useEditorStore.getState().load(emptyWorkflow("wf", "原名"));
    useEditorStore.setState({ clipboard: null, clipboardPastes: 0 });
  });

  it("undoes and redoes a rename", () => {
    const s = useEditorStore.getState();
    s.setName("新名字");
    s.undo();
    expect(useEditorStore.getState().name).toBe("原名");
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().name).toBe("新名字");
  });

  it("bumps the generation on every load", () => {
    const before = useEditorStore.getState().generation;
    useEditorStore.getState().load(emptyWorkflow(""));
    expect(useEditorStore.getState().generation).toBe(before + 1);
  });
});

describe("editor clipboard", () => {
  beforeEach(() => {
    useEditorStore.getState().load(emptyWorkflow("wf", "画布"));
    useEditorStore.setState({ clipboard: null, clipboardPastes: 0 });
    seedSelection();
  });

  it("copies the selection without marking the workflow dirty", () => {
    const before = useEditorStore.getState().revision;
    useEditorStore.getState().clearSelection();
    useEditorStore.getState().copySelected();
    useEditorStore.getState().pasteFromClipboard();
    useEditorStore.getState().duplicateSelected();
    expect(useEditorStore.getState().clipboard).toBeNull();
    expect(useEditorStore.getState().nodes).toHaveLength(3);
    expect(useEditorStore.getState().revision).toBe(before);

    seedSelection();
    useEditorStore.getState().copySelected();
    const clip = useEditorStore.getState().clipboard;
    expect(clip?.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(clip?.edges.map((e) => e.id)).toEqual(["e12"]);
    expect(useEditorStore.getState().revision).toBe(before);
    expect(useEditorStore.getState().past).toHaveLength(0);

    useEditorStore.getState().setWidget("n1", "note", "changed");
    expect(useEditorStore.getState().clipboard?.nodes[0]?.data.widgets.note).toBe("a");
  });

  it("pastes copies with new ids, unique aliases, and only internal links", () => {
    useEditorStore.getState().copySelected();
    useEditorStore.getState().pasteFromClipboard();
    const state = useEditorStore.getState();
    const created = state.nodes.filter((n) => !["n1", "n2", "n3"].includes(n.id));
    expect(created).toHaveLength(2);
    expect(created.every((n) => n.selected)).toBe(true);
    expect(state.nodes.filter((n) => ["n1", "n2", "n3"].includes(n.id)).every((n) => !n.selected)).toBe(true);
    expect(created.map((n) => n.data.alias).sort()).toEqual(["SAMPLESHEET_4", "SAMPLESHEET_5"]);
    expect(created.find((n) => n.data.widgets.note === "a")?.position).toEqual({
      x: 10 + PASTE_GAP,
      y: 20 + PASTE_GAP,
    });
    const link = state.edges.find((e) => e.id !== "e12" && e.id !== "e23");
    expect(link).toMatchObject({ sourceHandle: "out:reads", targetHandle: "in:reads" });
    expect(created.map((n) => n.id).sort()).toEqual([link?.source, link?.target].sort());
    expect(state.edges.some((e) => e.source === "n2" && e.target === "n3")).toBe(true);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(useEditorStore.getState().clipboard?.nodes).toHaveLength(2);
  });

  it("steps repeated pastes further and keeps the clipboard across a load", () => {
    useEditorStore.getState().copySelected();
    useEditorStore.getState().pasteFromClipboard();
    useEditorStore.getState().pasteFromClipboard();
    const second = useEditorStore
      .getState()
      .nodes.find((n) => n.selected && n.data.widgets.note === "a");
    expect(second?.position).toEqual({ x: 10 + PASTE_GAP * 2, y: 20 + PASTE_GAP * 2 });

    useEditorStore.getState().load(emptyWorkflow("other", "另一个"));
    expect(useEditorStore.getState().clipboard?.nodes).toHaveLength(2);
    useEditorStore.getState().pasteFromClipboard();
    const pasted = useEditorStore.getState().nodes;
    expect(pasted).toHaveLength(2);
    expect(pasted.map((n) => n.data.alias).sort()).toEqual(["SAMPLESHEET", "SAMPLESHEET_2"]);
  });

  it("duplicates the selection in place without replacing the clipboard", () => {
    useEditorStore.getState().copySelected();
    useEditorStore.getState().pasteFromClipboard();
    const pastes = useEditorStore.getState().clipboardPastes;
    useEditorStore.getState().duplicateSelected();
    expect(useEditorStore.getState().clipboardPastes).toBe(pastes);
    expect(useEditorStore.getState().nodes.filter((n) => n.selected)).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes).toHaveLength(5);

    useEditorStore.setState({ clipboard: null, clipboardPastes: 0 });
    useEditorStore.getState().clearSelection();
    useEditorStore.setState({
      nodes: useEditorStore.getState().nodes.map((n) => ({ ...n, selected: n.id === "n1" })),
    });
    useEditorStore.getState().duplicateSelected();
    expect(useEditorStore.getState().clipboard).toBeNull();
    const copy = useEditorStore.getState().nodes.find((n) => n.selected);
    expect(copy?.position).toEqual({ x: 10 + PASTE_GAP, y: 20 + PASTE_GAP });
    expect(copy?.data.alias).toBe("SAMPLESHEET_6");
  });

  it("gives a duplicated reference node its own param name", () => {
    useEditorStore.setState({
      nodes: [
        node("r1", "REFERENCE", { x: 0, y: 0 }, true, {
          moduleId: REFERENCE_ID,
          settings: { param: "fasta", format: "fasta" },
        }),
      ],
      edges: [],
    });
    useEditorStore.getState().duplicateSelected();
    const copy = useEditorStore.getState().nodes.find((n) => n.selected);
    expect(copy?.data.alias).toBe("REFERENCE_2");
    expect(copy?.data.settings).toMatchObject({ param: "fasta_2", format: "fasta" });
  });

  it("selects and clears selection without a history step", () => {
    const revision = useEditorStore.getState().revision;
    useEditorStore.getState().clearSelection();
    useEditorStore.getState().selectAllNodes();
    expect(useEditorStore.getState().nodes.every((n) => n.selected)).toBe(true);
    useEditorStore.getState().clearSelection();
    expect(useEditorStore.getState().nodes.some((n) => n.selected)).toBe(false);
    expect(useEditorStore.getState().revision).toBe(revision);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});
