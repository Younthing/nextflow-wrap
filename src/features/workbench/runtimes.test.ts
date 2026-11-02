import { describe, expect, it } from "vitest";

import { runtimeRows } from "./runtimes";

const specs = [{ name: "python3", displayName: "Python 3 (ipykernel)", language: "python" }];

describe("runtime rows", () => {
  it("list the server's kernels, then kernels only a notebook names, with their users", () => {
    const rows = runtimeRows([{ kernel: "python3" }, { kernel: "python3" }, { kernel: "py311-pandas" }], specs, false);
    expect(rows.map((row) => [row.name, row.users, Boolean(row.missing)])).toEqual([
      ["python3", 2, false],
      ["py311-pandas", 1, true],
    ]);
    expect(rows[0]!.label).toBe("Python 3 (ipykernel) · python3");
  });
  it("start from the seed kernels in the demo", () => {
    expect(runtimeRows([{ kernel: "py311-pandas" }], specs, true).map((row) => [row.name, row.users])).toEqual([
      ["py311-pandas", 1],
      ["r-deseq2", 0],
      ["python3.11", 0],
      ["python3", 0],
    ]);
  });
});
