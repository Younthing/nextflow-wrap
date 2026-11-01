import { describe, expect, it } from "vitest";

import { PercentError, readPercent, writePercent } from "./jupytext";
import type { NotebookCell, NotebookDoc } from "./types";

function notebook(cells: NotebookCell[], language: NotebookDoc["language"] = "python"): Pick<NotebookDoc, "name" | "description" | "kernel" | "language" | "cells"> {
  return {
    name: "qc_summary",
    description: "汇总 \"FastQC\"\n第二行",
    kernel: language === "r" ? "r-deseq2" : "py311-pandas",
    language,
    cells,
  };
}

describe("jupytext percent", () => {
  const sources = ["", "a", "a\n", "a\n\n", "\n", "\n\n", "a\nb", "a\nb\n", "# %% hidden\n", "line\n# %% hidden", "# <wrap-escape> # %% already\n"];

  it.each(sources)("round-trips code source %j", (source) => {
    const parsed = readPercent(writePercent(notebook([{ id: "c1", role: "code", source }])));
    expect(parsed.cells).toEqual([{ id: "c1", role: "code", source }]);
  });

  it.each(sources)("round-trips markdown source %j", (source) => {
    const parsed = readPercent(writePercent(notebook([{ id: "m1", role: "markdown", source }])));
    expect(parsed.cells).toEqual([{ id: "m1", role: "markdown", source }]);
  });

  it("keeps roles, order, and provenance", () => {
    const cells: NotebookCell[] = [
      { id: "in", role: "input", source: "# @input name=title type=str default=\"hi\"\ntitle = \"hi\"\n" },
      { id: "note", role: "markdown", source: "说明\n\n%%\n" },
      { id: "ex", role: "explore", source: "print('only here')\n" },
      { id: "out", role: "output", source: "# @output name=report type=path pattern=\"report.txt\"\nopen('report.txt','w').write(title)\n" },
      { id: "empty", role: "code", source: "" },
    ];
    const text = writePercent(notebook(cells), { sourceNotebookId: "qc_summary", sourceNotebookRev: 12 });
    expect(text).toContain("format_name: percent");
    expect(text).toContain("formats: ipynb,py:percent");
    const parsed = readPercent(text);
    expect(parsed.cells).toEqual(cells);
    expect(parsed.description).toBe("汇总 \"FastQC\"\n第二行");
    expect(parsed.kernel).toBe("py311-pandas");
    expect(parsed.language).toBe("python");
    expect(parsed.sourceNotebookId).toBe("qc_summary");
    expect(parsed.sourceNotebookRev).toBe(12);
  });

  it("round-trips a custom kernel such as python:3.12", () => {
    const text = writePercent({ ...notebook([{ id: "c1", role: "code", source: "print(1)\n" }]), kernel: "python:3.12" });
    expect(readPercent(text).kernel).toBe("python:3.12");
    expect(text).toContain("name: python:3.12");
  });

  it("writes an R percent header and reads it back", () => {
    const cells: NotebookCell[] = [
      { id: "d1", role: "input", source: "counts <- \"counts.tsv\"\n" },
      { id: "d2", role: "markdown", source: "不要当命令行\n" },
    ];
    const text = writePercent(notebook(cells, "r"));
    expect(text).toContain("formats: ipynb,R:percent");
    expect(text).toContain("language: r");
    expect(readPercent(text).cells).toEqual(cells);
    expect(readPercent(text).language).toBe("r");
  });

  it("reads a plain percent cell that has no wrap metadata", () => {
    const text = `# ---
# jupyter:
#   jupytext:
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#   kernelspec:
#     display_name: py311-pandas
#     language: python
#     name: py311-pandas
# ---
# wrap: {"name":"plain","description":"","kernel":"py311-pandas","language":"python"}

# %%
print(1)

# %% [markdown]
# 标题
`;
    expect(readPercent(text).cells).toEqual([
      { id: "c1", role: "code", source: "print(1)\n" },
      { id: "c2", role: "markdown", source: "标题" },
    ]);
  });

  it("rejects text that is not a percent notebook", () => {
    expect(() => readPercent("print(1)\n")).toThrow(PercentError);
  });
});
