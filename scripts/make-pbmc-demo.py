"""Writes the single-cell demo counts to an .h5ad file.

Usage: python3 scripts/make-pbmc-demo.py OUT.h5ad

Order of sources:
1. PBMC3K_H5AD, a path to a raw-count PBMC 3k .h5ad you already have.
2. scanpy.datasets.pbmc3k(), which downloads the 10x PBMC 3k raw counts (about 6 MB).
3. A deterministic synthetic PBMC-like matrix, when the download is not reachable.

Prints the source it used. Needs scanpy (python3 -m pip install scanpy igraph leidenalg).
"""

import os
import shutil
import sys


def synthetic(out):
    import anndata as ad
    import numpy as np
    import pandas as pd
    from scipy import sparse

    rng = np.random.default_rng(3)
    markers = {
        "T cells": ["CD3E", "CD3D", "IL7R", "LDHB"],
        "B cells": ["MS4A1", "CD79A", "CD79B", "CD74"],
        "Monocytes": ["LYZ", "CD14", "S100A9", "FCN1"],
        "NK cells": ["GNLY", "NKG7", "GZMB", "PRF1"],
    }
    genes = [g for names in markers.values() for g in names]
    genes += ["MT-CO1", "MT-ND1", "MT-ATP6"] + ["GENE%04d" % i for i in range(1200)]
    sizes = [300, 120, 150, 80]
    rows, labels = [], []
    for (label, names), size in zip(markers.items(), sizes):
        base = rng.gamma(1.0, 0.8, size=len(genes))
        for name in names:
            base[genes.index(name)] = 12.0
        for name in ("MT-CO1", "MT-ND1", "MT-ATP6"):
            base[genes.index(name)] = 3.0
        depth = rng.lognormal(0.0, 0.25, size=(size, 1))
        rows.append(rng.poisson(base * depth))
        labels += [label] * size
    counts = np.vstack(rows).astype(np.float32)
    adata = ad.AnnData(
        X=sparse.csr_matrix(counts),
        obs=pd.DataFrame({"truth": labels}, index=["cell%04d" % i for i in range(counts.shape[0])]),
        var=pd.DataFrame(index=genes),
    )
    adata.write_h5ad(out)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    given = os.environ.get("PBMC3K_H5AD")
    if given:
        shutil.copyfile(given, out)
        print("source: PBMC3K_H5AD %s" % given)
        return
    try:
        import scanpy as sc

        sc.settings.datasetdir = os.path.join(os.path.dirname(os.path.abspath(out)), "scanpy-data")
        adata = sc.datasets.pbmc3k()
        adata.write_h5ad(out)
        print("source: pbmc3k %d cells x %d genes" % adata.shape)
        return
    except Exception as error:  # Offline or blocked download.
        print("pbmc3k download failed (%s); writing synthetic counts" % error, file=sys.stderr)
    synthetic(out)
    print("source: synthetic")


if __name__ == "__main__":
    main()
