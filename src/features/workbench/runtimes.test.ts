import { describe, expect, it } from "vitest";

import { runtimeRows } from "./runtimes";

describe("runtime rows", () => {
  it("list built-in kernels, then Jupyter kernelspecs, then kernels only a notebook names", () => {
    const rows = runtimeRows(
      [{ kernel: "py311-pandas" }, { kernel: "py311-pandas" }, { kernel: "python:3.12" }],
      [{ name: "python3", displayName: "Python 3 (ipykernel)" }, { name: "py311-pandas", displayName: "dup" }],
    );
    expect(rows.map((row) => [row.name, row.users])).toEqual([
      ["py311-pandas", 2],
      ["r-deseq2", 0],
      ["python3.11", 0],
      ["python3", 0],
      ["python:3.12", 1],
    ]);
    expect(rows[3].label).toBe("Python 3 (ipykernel) · python3");
  });
});
