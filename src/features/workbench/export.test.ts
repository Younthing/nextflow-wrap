import { describe, expect, it } from "vitest";

import { readPercent } from "@/features/notebook/jupytext";
import type { NotebookDoc } from "@/features/notebook/types";
import { exportStem, portSummary, toIpynb, toScript } from "./export";

const doc: Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells"> = {
  name: "02 降维与聚类",
  description: "PCA 和 Leiden",
  kernel: "py311-pandas",
  language: "python",
  cells: [
    { id: "c1", role: "markdown", source: "# 降维\n说明" },
    { id: "c2", role: "input", source: "path = 'data/pbmc.h5ad'" },
    { id: "c3", role: "code", source: "print(1)\nprint(2)" },
  ],
};

describe("notebook export", () => {
  it("name files after the notebook", () => {
    expect(exportStem(" 02 降维/聚类 ")).toBe("02_降维_聚类");
    expect(exportStem("  ")).toBe("notebook");
  });

  it("write nbformat 4 with roles and this session's outputs", () => {
    const file = toIpynb(doc, { c3: { id: "c3", stdout: "1\n2\n", executionCount: 4, outputs: [{ outputType: "stream", name: "stdout", text: "1\n2\n" }, { outputType: "execute_result", data: { "text/plain": "3" } }] } });
    expect(file.name).toBe("02_降维与聚类.ipynb");
    const nb = JSON.parse(file.content);
    expect(nb).toMatchObject({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3" } } });
    expect(nb.cells.map((cell: { cell_type: string }) => cell.cell_type)).toEqual(["markdown", "code", "code"]);
    expect(nb.cells[0].source).toEqual(["# 降维\n", "说明"]);
    expect(nb.cells[1].metadata).toEqual({ nextflow_studio: { role: "input" } });
    expect(nb.cells[1].outputs).toEqual([]);
    expect(nb.cells[2]).toMatchObject({ execution_count: 4, outputs: [{ output_type: "stream", name: "stdout", text: ["1\n", "2\n"] }, { output_type: "execute_result", execution_count: 4, data: { "text/plain": ["3"] } }] });
  });

  it("pick the R kernelspec for R notebooks", () => {
    const nb = JSON.parse(toIpynb({ ...doc, language: "r", kernel: "r-deseq2" }).content);
    expect(nb.metadata.kernelspec.name).toBe("ir");
  });

  it("write a percent script that reads back", () => {
    const file = toScript(doc);
    expect(file.name).toBe("02_降维与聚类.py");
    expect(readPercent(file.content).cells.map((cell) => cell.role)).toEqual(["markdown", "input", "code"]);
    expect(toScript({ ...doc, language: "r" }).name).toBe("02_降维与聚类.R");
  });

  it("describe the module ports", () => {
    expect(portSummary(0, 0)).toBe("先把单元格标成输入、输出");
    expect(portSummary(1, 2)).toBe("已标 1 个输入、2 个输出");
  });
});
