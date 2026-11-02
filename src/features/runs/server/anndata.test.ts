import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { summarizeAnnData } from "./anndata";

// Writes the anndata ≥0.8 on-disk layout with h5py alone (CI installs h5py next to ipykernel).
const WRITE = String.raw`
import sys, h5py, numpy as np
s = h5py.string_dtype()
with h5py.File(sys.argv[1], "w") as f:
    x = f.create_group("X"); x.attrs["encoding-type"] = "csr_matrix"; x.attrs["shape"] = (3, 2)
    x["data"] = np.ones(4, dtype="float32"); x["indices"] = [0, 1, 0, 1]; x["indptr"] = [0, 2, 3, 4]
    obs = f.create_group("obs"); obs.attrs["_index"] = "_index"; obs.attrs["column-order"] = ["leiden", "total_counts"]
    obs.create_dataset("_index", data=["c1", "c2", "c3"], dtype=s)
    leiden = obs.create_group("leiden"); leiden.attrs["encoding-type"] = "categorical"
    leiden.create_dataset("categories", data=["0", "1"], dtype=s); leiden["codes"] = np.array([0, 1, 0], dtype="int8")
    obs["total_counts"] = np.array([1.0, 2.0, 3.0], dtype="float32")
    var = f.create_group("var"); var.attrs["_index"] = "_index"; var.attrs["column-order"] = []
    var.create_dataset("_index", data=["CD3E", "MS4A1"], dtype=s)
    f.create_group("obsm")["X_umap"] = np.zeros((3, 2))
    f.create_group("layers")["counts"] = np.zeros((3, 2))
    f.create_group("uns").create_group("neighbors")
`;

const dir = mkdtempSync(join(tmpdir(), "nfs-h5ad-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("summarizeAnnData", () => {
  it("reads shape, columns and embeddings from HDF5 metadata", async () => {
    const file = join(dir, "pbmc.h5ad");
    execFileSync("python3", ["-c", WRITE, file]);
    const summary = await summarizeAnnData(file, "python3");
    expect(summary).toMatchObject({
      nObs: 3, nVars: 2, matrix: "csr_matrix float32",
      obs: [{ name: "leiden", dtype: "category", categories: ["0", "1"], categoryCount: 2 }, { name: "total_counts", dtype: "float32" }],
      var: [], obsm: [{ name: "X_umap", shape: [3, 2] }], layers: ["counts"], uns: ["neighbors"],
      obsNames: ["c1", "c2", "c3"], varNames: ["CD3E", "MS4A1"],
    });
  });

  it("explains a file that is not HDF5", async () => {
    const file = join(dir, "broken.h5ad");
    execFileSync("python3", ["-c", `open(${JSON.stringify(file)}, "w").write("nope")`]);
    await expect(summarizeAnnData(file, "python3")).rejects.toThrow(/无法读取 h5ad/);
  });
});
