import { describe, expect, it } from "vitest";

import { IpynbError, notebookFromIpynb, notebookToIpynb, serializeIpynb } from "./ipynb";
import type { IpynbNotebook } from "./ipynb";

const doc: IpynbNotebook = {
  id: "nb_qc",
  name: "01 质控",
  description: "PBMC 质控",
  kernel: "py311-pandas",
  language: "python",
  cells: [
    { id: "md", role: "markdown", source: "# 质控\n说明" },
    { id: "in", role: "input", source: "# @input name=adata type=path\nadata = 'pbmc.h5ad'\n" },
    { id: "work", role: "code", source: "import scanpy as sc\n" },
    { id: "look", role: "explore", source: "adata" },
    { id: "out", role: "output", source: "# @output name=qc type=path pattern=\"qc.h5ad\"\n" },
  ],
};

describe("ipynb", () => {
  it("writes standard nbformat 4.5 with the app's roles in cell metadata", () => {
    const nb = notebookToIpynb(doc);
    expect(nb.nbformat).toBe(4);
    expect(nb.nbformat_minor).toBe(5);
    expect(nb.metadata.kernelspec).toEqual({ name: "py311-pandas", display_name: "Python 3.11 · py311-pandas", language: "python" });
    expect(nb.cells.map((cell) => cell.cell_type)).toEqual(["markdown", "code", "code", "code", "code"]);
    expect(nb.cells[0].source).toEqual(["# 质控\n", "说明"]);
    expect(nb.cells[1].metadata).toEqual({ nextflow_studio: { role: "input" } });
    expect(nb.cells[2].metadata).toEqual({});
    expect(nb.cells[2]).toMatchObject({ outputs: [], execution_count: null });
  });

  it("reads back exactly what it wrote", () => {
    expect(notebookFromIpynb(serializeIpynb(doc), "ignored")).toEqual(doc);
  });

  it("opens a notebook made in Jupyter", () => {
    const raw = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 4,
      metadata: { kernelspec: { name: "ir", display_name: "R", language: "R" } },
      cells: [
        { cell_type: "markdown", metadata: {}, source: ["# DE\n"] },
        { cell_type: "code", metadata: { tags: ["x"] }, source: "library(DESeq2)", outputs: [{ output_type: "stream", text: "ok" }], execution_count: 3 },
        { cell_type: "raw", metadata: {}, source: "dropped" },
        { cell_type: "code", id: "dup", metadata: {}, source: "", outputs: [] },
        { cell_type: "code", id: "dup", metadata: {}, source: "", outputs: [] },
      ],
    });
    const read = notebookFromIpynb(raw, "deseq");
    expect(read.id).toBeUndefined();
    expect(read).toMatchObject({ name: "deseq", description: "", kernel: "ir", language: "r" });
    expect(read.cells.map((cell) => [cell.id, cell.role])).toEqual([["c1", "markdown"], ["c2", "code"], ["dup", "code"], ["c5", "code"]]);
  });

  it("rejects files that are not notebooks", () => {
    expect(() => notebookFromIpynb("{", "x")).toThrow(IpynbError);
    expect(() => notebookFromIpynb(JSON.stringify({ nbformat: 3, cells: [] }), "x")).toThrow(IpynbError);
    expect(() => notebookFromIpynb(JSON.stringify({ nbformat: 4, cells: [{ cell_type: "code", source: 3 }] }), "x")).toThrow(IpynbError);
  });
});
