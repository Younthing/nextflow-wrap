import { beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_MODULES, REFERENCE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowNodeData } from "@/features/workflow/types";
import { PASTE_GAP } from "./clipboard";
import { PLACEMENT_CLEAR_X, placeWithoutOverlap } from "./placement";
import { selectHasSelection, useEditorStore, type FlowEdge, type FlowNode } from "./store";

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
    expect(clip?.params).toEqual({});
    expect(useEditorStore.getState().revision).toBe(before);
    expect(useEditorStore.getState().past).toHaveLength(0);

    useEditorStore.getState().setWidget("n1", "note", "changed");
    expect(useEditorStore.getState().clipboard?.nodes[0]?.data.widgets.note).toBe("a");
  });

  it("clears a selected edge when pasting or duplicating", () => {
    useEditorStore.setState({
      edges: useEditorStore.getState().edges.map((edge) => ({ ...edge, selected: edge.id === "e23" })),
    });
    useEditorStore.getState().duplicateSelected();
    const duplicated = useEditorStore.getState();
    expect(duplicated.edges.find((edge) => edge.id === "e23")?.selected).toBe(false);
    expect(duplicated.edges.every((edge) => !edge.selected)).toBe(true);
    expect(duplicated.nodes.some((node) => node.selected)).toBe(true);
    expect(duplicated.edges.some((edge) => edge.id === "e23")).toBe(true);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().edges.find((edge) => edge.id === "e23")?.selected).toBe(true);

    useEditorStore.getState().copySelected();
    useEditorStore.getState().pasteFromClipboard();
    const pasted = useEditorStore.getState();
    expect(pasted.edges.find((edge) => edge.id === "e23")?.selected).toBe(false);
    expect(pasted.edges.every((edge) => !edge.selected)).toBe(true);
    expect(pasted.nodes.some((node) => node.selected)).toBe(true);
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

  it("duplicates the selection beside the originals without replacing the clipboard", () => {
    useEditorStore.getState().copySelected();
    useEditorStore.getState().pasteFromClipboard();
    const pastes = useEditorStore.getState().clipboardPastes;
    const before = useEditorStore.getState();
    const sources = before.nodes.filter((n) => n.selected);
    useEditorStore.getState().duplicateSelected();
    const duplicated = useEditorStore.getState();
    expect(duplicated.clipboardPastes).toBe(pastes);
    const copies = duplicated.nodes.filter((n) => n.selected);
    expect(copies).toHaveLength(2);
    const copyIds = new Set(copies.map((node) => node.id));
    const link = duplicated.edges.find((edge) => copyIds.has(edge.source) && copyIds.has(edge.target));
    expect(link).toMatchObject({ sourceHandle: "out:reads", targetHandle: "in:reads" });
    expect(copies.map((node) => node.id).sort()).toEqual([link?.source, link?.target].sort());
    const noted = copies.find((node) => node.data.widgets.note === "a");
    const source = sources.find((node) => node.data.widgets.note === "a");
    expect(noted?.position).toEqual({
      x: (source?.position.x ?? 0) + PASTE_GAP,
      y: (source?.position.y ?? 0) + PASTE_GAP,
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes).toHaveLength(5);
    expect(useEditorStore.getState().edges).toHaveLength(before.edges.length);

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

  it("gives a duplicated reference node its own param name and path", () => {
    const fasta = "s3://bucket/genome.fa";
    useEditorStore.setState({
      params: { ...useEditorStore.getState().params, fasta },
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
    expect(useEditorStore.getState().params.fasta).toBe(fasta);
    expect(useEditorStore.getState().params.fasta_2).toBe(fasta);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().params.fasta).toBe(fasta);
    expect(useEditorStore.getState().params.fasta_2).toBeUndefined();
    expect(useEditorStore.getState().nodes).toHaveLength(1);
  });

  it("does not invent a path when the reference param was unset", () => {
    useEditorStore.setState({
      params: {},
      nodes: [
        node("r1", "REFERENCE", { x: 0, y: 0 }, true, {
          moduleId: REFERENCE_ID,
          settings: { param: "fasta", format: "fasta" },
        }),
      ],
      edges: [],
    });
    useEditorStore.getState().duplicateSelected();
    expect(useEditorStore.getState().nodes.find((n) => n.selected)?.data.settings?.param).toBe("fasta_2");
    expect(useEditorStore.getState().params).toEqual({});
  });

  it("keeps params.input when duplicating a reference named input_2", () => {
    const samplesheet = "assets/samplesheet.csv";
    const path = "s3://bucket/extra.fa";
    useEditorStore.setState({
      params: { input: samplesheet, input_2: path, outdir: "results" },
      nodes: [
        node("r1", "REFERENCE", { x: 0, y: 0 }, true, {
          moduleId: REFERENCE_ID,
          settings: { param: "input_2", format: "fasta" },
        }),
      ],
      edges: [],
    });
    useEditorStore.getState().duplicateSelected();
    const copy = useEditorStore.getState().nodes.find((n) => n.selected);
    expect(copy?.data.settings).toMatchObject({ param: "input_3", format: "fasta" });
    expect(useEditorStore.getState().params).toEqual({
      input: samplesheet,
      input_2: path,
      input_3: path,
      outdir: "results",
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().params).toEqual({
      input: samplesheet,
      input_2: path,
      outdir: "results",
    });
    expect(useEditorStore.getState().nodes).toHaveLength(1);
  });

  it("pastes reference paths into another workflow under the remapped names", () => {
    const fasta = "s3://bucket/genome.fa";
    const gtf = "s3://bucket/genes.gtf";
    const reference = (id: string, alias: string, param: string, format: string, y: number): FlowNode =>
      node(id, alias, { x: 0, y }, true, { moduleId: REFERENCE_ID, settings: { param, format } });
    useEditorStore.setState({
      params: { fasta, gtf, input: "assets/samplesheet.csv" },
      nodes: [reference("r1", "REFERENCE", "fasta", "fasta", 0), reference("r2", "REFERENCE_2", "gtf", "gtf", 200)],
      edges: [],
    });
    useEditorStore.getState().copySelected();
    useEditorStore.getState().setParam("fasta", "s3://changed/genome.fa");
    expect(useEditorStore.getState().clipboard?.params).toEqual({ fasta, gtf });

    useEditorStore.getState().load(emptyWorkflow("other", "另一个"));
    useEditorStore.setState({
      params: { fasta: "s3://destination/genome.fa", input: "other.csv" },
      nodes: [
        node("kept", "REFERENCE", { x: 0, y: 0 }, false, {
          moduleId: REFERENCE_ID,
          settings: { param: "fasta", format: "fasta" },
        }),
      ],
      edges: [],
    });
    useEditorStore.getState().pasteFromClipboard();
    const pasted = useEditorStore.getState().nodes.filter((n) => n.selected);
    expect(pasted.find((n) => n.data.settings?.format === "fasta")?.data.settings?.param).toBe("fasta_2");
    expect(pasted.find((n) => n.data.settings?.format === "gtf")?.data.settings?.param).toBe("gtf");
    expect(useEditorStore.getState().params).toEqual({
      fasta: "s3://destination/genome.fa",
      fasta_2: fasta,
      gtf,
      input: "other.csv",
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().params).toEqual({
      fasta: "s3://destination/genome.fa",
      input: "other.csv",
    });
    expect(useEditorStore.getState().nodes.map((n) => n.id)).toEqual(["kept"]);
  });

  it("keeps a destination param key when pasting into another workflow", () => {
    const path = "s3://bucket/extra.fa";
    useEditorStore.setState({
      params: { input: "assets/samplesheet.csv", input_2: path, outdir: "results" },
      nodes: [
        node("r1", "REFERENCE", { x: 0, y: 0 }, true, {
          moduleId: REFERENCE_ID,
          settings: { param: "input_2", format: "fasta" },
        }),
      ],
      edges: [],
    });
    useEditorStore.getState().copySelected();

    useEditorStore.getState().load(emptyWorkflow("other", "另一个"));
    useEditorStore.setState({
      params: { input: "other.csv", input_2: "s3://destination/keep.fa", outdir: "elsewhere" },
      nodes: [],
      edges: [],
    });
    useEditorStore.getState().pasteFromClipboard();
    const pasted = useEditorStore.getState().nodes.find((n) => n.selected);
    expect(pasted?.data.settings).toMatchObject({ param: "input_3", format: "fasta" });
    expect(useEditorStore.getState().params).toEqual({
      input: "other.csv",
      input_2: "s3://destination/keep.fa",
      input_3: path,
      outdir: "elsewhere",
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().params).toEqual({
      input: "other.csv",
      input_2: "s3://destination/keep.fa",
      outdir: "elsewhere",
    });
    expect(useEditorStore.getState().nodes).toHaveLength(0);
  });

  it("selects and clears nodes and edges without a history step", () => {
    const revision = useEditorStore.getState().revision;
    useEditorStore.getState().clearSelection();
    useEditorStore.getState().selectAllNodes();
    useEditorStore.setState({
      edges: useEditorStore.getState().edges.map((edge) => ({ ...edge, selected: true })),
    });
    expect(useEditorStore.getState().nodes.every((n) => n.selected)).toBe(true);
    expect(selectHasSelection(useEditorStore.getState())).toBe(true);
    useEditorStore.getState().clearSelection();
    expect(useEditorStore.getState().nodes.some((n) => n.selected)).toBe(false);
    expect(useEditorStore.getState().edges.some((e) => e.selected)).toBe(false);
    expect(useEditorStore.getState().revision).toBe(revision);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });

  it("deletes selected nodes and every edge that touches them", () => {
    useEditorStore.getState().copySelected();
    const revision = useEditorStore.getState().revision;
    useEditorStore.getState().deleteSelected();
    const deleted = useEditorStore.getState();
    expect(deleted.nodes.map((node) => node.id)).toEqual(["n3"]);
    expect(deleted.edges).toEqual([]);
    expect(deleted.past).toHaveLength(1);
    expect(deleted.future).toEqual([]);
    expect(deleted.revision).toBe(revision + 1);
    expect(deleted.clipboard?.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);

    deleted.undo();
    const restored = useEditorStore.getState();
    expect(restored.nodes.map((node) => node.id)).toEqual(["n1", "n2", "n3"]);
    expect(restored.nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(restored.edges.map((edge) => edge.id)).toEqual(["e12", "e23"]);
    restored.redo();
    expect(useEditorStore.getState().nodes.map((node) => node.id)).toEqual(["n3"]);
    expect(useEditorStore.getState().edges).toEqual([]);
  });

  it("keeps an edge between nodes that stay and drops a selected edge in the same step", () => {
    useEditorStore.setState({
      nodes: [
        node("n1", "A", { x: 0, y: 0 }, true),
        node("n2", "B", { x: 200, y: 0 }, false),
        node("n3", "C", { x: 400, y: 0 }, false),
      ],
      edges: [
        { id: "e12", source: "n1", target: "n2", sourceHandle: "out:reads", targetHandle: "in:reads" },
        { id: "e23", source: "n2", target: "n3", sourceHandle: "out:reads", targetHandle: "in:reads" },
        { id: "e-extra", source: "n2", target: "n3", sourceHandle: "out:reads", targetHandle: "in:reads", selected: true },
      ],
    });
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().nodes.map((n) => n.id)).toEqual(["n2", "n3"]);
    expect(useEditorStore.getState().edges.map((edge) => edge.id)).toEqual(["e23"]);
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(useEditorStore.getState().edges.map((edge) => edge.id)).toEqual(["e12", "e23", "e-extra"]);
    expect(useEditorStore.getState().edges.find((edge) => edge.id === "e-extra")?.selected).toBe(true);
  });

  it("deletes a selected edge whose nodes stay", () => {
    useEditorStore.getState().clearSelection();
    useEditorStore.setState({
      edges: useEditorStore.getState().edges.map((edge) => ({ ...edge, selected: edge.id === "e23" })),
    });
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().nodes.map((node) => node.id)).toEqual(["n1", "n2", "n3"]);
    expect(useEditorStore.getState().edges.map((edge) => edge.id)).toEqual(["e12"]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().edges.map((edge) => edge.id)).toEqual(["e12", "e23"]);
    expect(useEditorStore.getState().edges.find((edge) => edge.id === "e23")?.selected).toBe(true);
  });

  it("does not record an undo step when nothing is selected", () => {
    useEditorStore.getState().clearSelection();
    const revision = useEditorStore.getState().revision;
    useEditorStore.getState().deleteSelected();
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().revision).toBe(revision);
    expect(useEditorStore.getState().past).toHaveLength(0);
    expect(useEditorStore.getState().nodes).toHaveLength(3);
    expect(useEditorStore.getState().edges).toHaveLength(2);
  });

  it("clears a selection that is only edges", () => {
    useEditorStore.getState().clearSelection();
    useEditorStore.setState({
      edges: useEditorStore.getState().edges.map((edge) => ({ ...edge, selected: edge.id === "e23" })),
    });
    expect(selectHasSelection(useEditorStore.getState())).toBe(true);
    expect(selectHasSelection({ nodes: [{ selected: false }], edges: [{ selected: false }] })).toBe(false);
    const revision = useEditorStore.getState().revision;
    useEditorStore.getState().clearSelection();
    expect(selectHasSelection(useEditorStore.getState())).toBe(false);
    expect(useEditorStore.getState().edges.every((edge) => !edge.selected)).toBe(true);
    expect(useEditorStore.getState().revision).toBe(revision);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});

describe("add node placement", () => {
  beforeEach(() => {
    useEditorStore.getState().load(emptyWorkflow("wf", "画布"));
    useEditorStore.getState().setIndex(indexModules(BUILTIN_MODULES));
  });

  it("keeps a free spot and shifts a node dropped on an existing card", () => {
    const def = BUILTIN_MODULES[0]!;
    const requested = { x: 40, y: 60 };
    const first = useEditorStore.getState().addNode(def, requested);
    expect(first.position).toEqual(requested);

    const stacked = useEditorStore.getState().addNode(def, requested);
    expect(stacked.position).toEqual(placeWithoutOverlap(requested, [requested]));
    expect(stacked.position).toEqual({ x: requested.x + PLACEMENT_CLEAR_X, y: requested.y });
    const stored = useEditorStore.getState().nodes.find((n) => n.id === stacked.id);
    expect(stored?.position).toEqual(stacked.position);
    expect(stored?.selected).toBe(true);
    expect(useEditorStore.getState().nodes.find((n) => n.id === first.id)?.selected).toBe(false);
  });
});
