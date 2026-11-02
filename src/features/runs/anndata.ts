/** What the results pane shows for an `.h5ad` file. Read from HDF5 metadata, so the matrix itself is never loaded. */
export interface AnnDataColumn {
  name: string;
  /** `category` with its levels, or the stored dtype such as `float32`. */
  dtype: string;
  categories?: string[];
  /** Number of levels when there are more than `categories` lists. */
  categoryCount?: number;
}

export interface AnnDataSummary {
  nObs: number;
  nVars: number;
  /** `dense`, `csr_matrix` or `csc_matrix`, with the dtype. */
  matrix: string;
  obs: AnnDataColumn[];
  var: AnnDataColumn[];
  obsm: { name: string; shape: number[] }[];
  layers: string[];
  uns: string[];
  /** First few obs / var names, to see what the index holds. */
  obsNames: string[];
  varNames: string[];
}

/** Deterministic summary used by mocks and stories: a clustered PBMC object. */
export function sampleAnnDataSummary(path = "cluster/pbmc.h5ad"): AnnDataSummary {
  const clustered = /cluster|leiden|umap/i.test(path);
  return {
    nObs: 2638,
    nVars: 1838,
    matrix: "csr_matrix float32",
    obs: [
      { name: "n_genes_by_counts", dtype: "int32" },
      { name: "total_counts", dtype: "float32" },
      { name: "pct_counts_mt", dtype: "float32" },
      ...(clustered ? [{ name: "leiden", dtype: "category", categories: ["0", "1", "2", "3", "4", "5", "6", "7"], categoryCount: 8 }] : []),
    ],
    var: [
      { name: "gene_ids", dtype: "string" },
      { name: "highly_variable", dtype: "bool" },
      { name: "means", dtype: "float64" },
    ],
    obsm: clustered ? [{ name: "X_pca", shape: [2638, 50] }, { name: "X_umap", shape: [2638, 2] }] : [],
    layers: ["counts"],
    uns: clustered ? ["leiden", "neighbors", "pca", "umap"] : ["log1p"],
    obsNames: ["AAACATACAACCAC-1", "AAACATTGAGCTAC-1", "AAACATTGATCAGC-1"],
    varNames: ["TNFRSF4", "CPSF3L", "ATAD3C"],
  };
}
