import { describe, expect, it } from "vitest";

import { FILE_ID, FOLDER_ID } from "@/features/workflow/builtins";
import type { ModuleDef, WorkflowNodeData as NodeData } from "@/features/workflow/types";
import { sourceValues } from "./source-values";

const def: ModuleDef = {
  id: "script/qc/v1",
  name: "qc",
  path: "",
  category: "notebook",
  description: "",
  sourceNotebookId: "nb_qc",
  inputs: [
    { name: "adata", description: "", elements: [{ name: "adata", type: "file", kind: "file", description: "" }] },
    { name: "ref", description: "", elements: [{ name: "ref", type: "directory", kind: "file", description: "", format: "dir" }] },
    { name: "extra", description: "", elements: [{ name: "extra", type: "file", kind: "file", description: "" }] },
    { name: "min_genes", description: "", widget: "integer", elements: [{ name: "min_genes", type: "integer", kind: "value", description: "" }] },
    { name: "note", description: "", widget: "string", elements: [{ name: "note", type: "string", kind: "value", description: "" }] },
  ],
  outputs: [],
} as unknown as ModuleDef;

const data = (moduleId: string, alias: string, extra: Partial<NodeData> = {}) =>
  ({ moduleId, alias, widgets: {}, config: {}, ...extra }) as unknown as NodeData;

describe("sourceValues", () => {
  it("hands over widget values and the paths of linked input nodes", () => {
    const node = { id: "qc", data: data(def.id, "SCANPY_QC", { widgets: { min_genes: 300, note: "" } }) };
    const nodes = [
      node,
      { id: "f", data: data(FILE_ID, "COUNTS", { settings: { path: "/data/pbmc.h5ad" } }) },
      { id: "d", data: data(FOLDER_ID, "REF", { settings: { path: "/data/ref" } }) },
      { id: "m", data: data("script/other/v1", "UPSTREAM") },
    ];
    const edges = [
      { source: "f", target: "qc", targetHandle: "in:adata" },
      { source: "d", target: "qc", targetHandle: "in:ref" },
      { source: "m", target: "qc", targetHandle: "in:extra" },
    ];
    expect(sourceValues(node, def, nodes, edges)).toEqual({
      from: "SCANPY_QC",
      values: { min_genes: "300", adata: "/data/pbmc.h5ad", ref: "/data/ref" },
    });
  });
});
