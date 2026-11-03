import { describe, expect, it } from "vitest";

import { applyCanvasValues, inputLiteral, readCanvasValues, notebookHref } from "./canvas-values";
import type { MarkerInput, NotebookCell } from "./types";

const inputs: MarkerInput[] = [
  { name: "adata", type: "path", required: true },
  { name: "min_genes", type: "int", required: false, defaultValue: "200" },
  { name: "plots", type: "bool", required: false, defaultValue: "false" },
  { name: "zips", type: "path[]", required: true },
];

describe("canvas values in the URL", () => {
  it("round-trips through the workbench link", () => {
    const href = notebookHref("nb_1", { from: "SCANPY_QC", values: { adata: "/data/pbmc 3k.h5ad", min_genes: "300" } });
    expect(href.startsWith("/workbench/nb_1?")).toBe(true);
    const query = new URLSearchParams(href.split("?")[1]);
    expect(readCanvasValues(query)).toEqual({ from: "SCANPY_QC", values: { adata: "/data/pbmc 3k.h5ad", min_genes: "300" } });
  });

  it("links to the plain notebook when there is nothing to hand over", () => {
    expect(notebookHref("nb_1", { from: "X", values: {} })).toBe("/workbench/nb_1");
    expect(readCanvasValues(new URLSearchParams("rev=3"))).toBeNull();
  });
});

describe("inputLiteral", () => {
  it("writes each type the way the language reads it", () => {
    expect(inputLiteral(inputs[0], "/a/b.h5ad", "python")).toBe('"/a/b.h5ad"');
    expect(inputLiteral(inputs[1], "300", "python")).toBe("300");
    expect(inputLiteral(inputs[1], "many", "python")).toBeNull();
    expect(inputLiteral(inputs[2], "true", "python")).toBe("True");
    expect(inputLiteral(inputs[2], "false", "r")).toBe("FALSE");
    expect(inputLiteral(inputs[3], "a.zip,b.zip", "python")).toBe('["a.zip", "b.zip"]');
    expect(inputLiteral(inputs[3], "a.zip,b.zip", "r")).toBe('c("a.zip", "b.zip")');
  });
});

describe("applyCanvasValues", () => {
  const cells: NotebookCell[] = [
    { id: "md", role: "markdown", source: "adata = 'not code'" },
    {
      id: "in",
      role: "input",
      source: ['# @input name=adata type=path required', '# @input name=min_genes type=int default=200', 'adata = "old.h5ad"', "", "print(adata)"].join("\n"),
    },
  ];

  it("replaces existing assignments and adds missing ones under the markers", () => {
    const result = applyCanvasValues(cells, inputs, { adata: "/data/new.h5ad", min_genes: "300", other: "x" }, "python");
    expect(result.cells[0]).toBe(cells[0]);
    expect(result.cells[1].source).toBe(
      ['# @input name=adata type=path required', '# @input name=min_genes type=int default=200', 'adata = "/data/new.h5ad"', "min_genes = 300", "", "print(adata)"].join("\n"),
    );
    expect(result.applied).toEqual([
      { name: "adata", literal: '"/data/new.h5ad"' },
      { name: "min_genes", literal: "300" },
    ]);
  });

  it("replaces R arrow assignments", () => {
    const r: NotebookCell[] = [{ id: "r", role: "input", source: '# @input name=adata type=path required\nadata <- "counts.tsv"' }];
    expect(applyCanvasValues(r, inputs, { adata: "/x.tsv" }, "r").cells[0].source).toBe('# @input name=adata type=path required\nadata = "/x.tsv"');
  });

  it("leaves cells alone when nothing changes", () => {
    const same = applyCanvasValues(cells, inputs, { adata: "old.h5ad" }, "python");
    expect(same.cells[1]).toBe(cells[1]);
    expect(same.applied).toHaveLength(1);
  });
});
