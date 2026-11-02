import { describe, expect, it } from "vitest";

import { FILE_ID, FOLDER_ID } from "./builtins";
import { demoWorkflow } from "./demo";
import { inputParams, launchParams } from "./inputs";
import type { WorkflowNode } from "./types";

const input = (id: string, moduleId: string, alias: string, settings: WorkflowNode["data"]["settings"]): WorkflowNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { moduleId, alias, widgets: {}, config: {}, settings },
});

describe("inputParams", () => {
  it("names each input after its alias and reads the format from the path", () => {
    const nodes = [
      input("f", FILE_ID, "COUNTS", { path: "/data/pbmc3k.h5ad" }),
      input("d", FOLDER_ID, "MATRIX", { path: "/data/filtered_feature_bc_matrix" }),
      input("o", FILE_ID, "EXTRA", { optional: true }),
      { ...input("x", FILE_ID, "OFF", { path: "/data/off.csv" }), data: { ...input("x", FILE_ID, "OFF", {}).data, disabled: true } },
    ];
    expect(inputParams({ nodes })).toEqual([
      { name: "counts", kind: "file", path: "/data/pbmc3k.h5ad", format: "h5ad", optional: false, nodeAlias: "COUNTS" },
      { name: "matrix", kind: "folder", path: "/data/filtered_feature_bc_matrix", format: "dir", optional: false, nodeAlias: "MATRIX" },
      { name: "extra", kind: "file", path: "", format: undefined, optional: true, nodeAlias: "EXTRA" },
    ]);
  });
});

describe("launchParams", () => {
  it("adds the chosen paths to the workflow params", () => {
    expect(launchParams(demoWorkflow("wf"))).toEqual({ outdir: "results", counts: "data/pbmc3k.h5ad" });
  });

  it("leaves out inputs with no path", () => {
    const nodes = [input("o", FILE_ID, "EXTRA", { optional: true })];
    expect(launchParams({ nodes, params: { outdir: "results" } })).toEqual({ outdir: "results" });
  });
});
