import { http, HttpResponse } from "msw";

import type { FsEntry, FsListing } from "@/features/files/types";

/** A small fixed tree for the demo file picker: single-cell and docking inputs. */
const TREE: Record<string, FsEntry[]> = {
  "/home/demo": [
    { name: "data", path: "/home/demo/data", kind: "directory" },
    { name: "refs", path: "/home/demo/refs", kind: "directory" },
  ],
  "/home/demo/data": [
    { name: "filtered_feature_bc_matrix", path: "/home/demo/data/filtered_feature_bc_matrix", kind: "directory" },
    { name: "pbmc3k.h5ad", path: "/home/demo/data/pbmc3k.h5ad", kind: "file", size: 24_183_520 },
    { name: "ligands.sdf", path: "/home/demo/data/ligands.sdf", kind: "file", size: 812_330 },
  ],
  "/home/demo/data/filtered_feature_bc_matrix": [
    { name: "barcodes.tsv.gz", path: "/home/demo/data/filtered_feature_bc_matrix/barcodes.tsv.gz", kind: "file", size: 20_480 },
    { name: "features.tsv.gz", path: "/home/demo/data/filtered_feature_bc_matrix/features.tsv.gz", kind: "file", size: 264_000 },
    { name: "matrix.mtx.gz", path: "/home/demo/data/filtered_feature_bc_matrix/matrix.mtx.gz", kind: "file", size: 4_700_000 },
  ],
  "/home/demo/refs": [{ name: "1hsg_receptor.pdb", path: "/home/demo/refs/1hsg_receptor.pdb", kind: "file", size: 160_000 }],
};

export const fsHandlers = [
  http.get("/api/fs/list", ({ request }) => {
    const requested = new URL(request.url).searchParams.get("path") ?? "/home/demo";
    const path = TREE[requested] ? requested : requested.slice(0, requested.lastIndexOf("/")) in TREE ? requested.slice(0, requested.lastIndexOf("/")) : "/home/demo";
    const parent = path === "/home/demo" ? "/home" : path.slice(0, path.lastIndexOf("/"));
    return HttpResponse.json<FsListing>({ path, parent: path === "/home" ? undefined : parent, entries: TREE[path] ?? [], home: "/home/demo" });
  }),
];
