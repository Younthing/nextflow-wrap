import { http, HttpResponse } from "msw";

import type { FsEntry, FsListing } from "@/features/files/types";
import { PROJECT_SCAFFOLD } from "@/features/workspace/projects";
import { MOCK_EXAMPLE_PROJECT_PATH, readDb } from "./db";

const EXAMPLE = MOCK_EXAMPLE_PROJECT_PATH;

/** A small fixed tree for the demo file picker and the example project: single-cell and docking inputs. */
const TREE: Record<string, FsEntry[]> = {
  "/home/demo": [
    { name: "Projects", path: "/home/demo/Projects", kind: "directory" },
    { name: "data", path: "/home/demo/data", kind: "directory" },
    { name: "projects", path: "/home/demo/projects", kind: "directory" },
    { name: "refs", path: "/home/demo/refs", kind: "directory" },
  ],
  "/home/demo/Projects": [
    { name: "visium-pilot", path: "/home/demo/Projects/visium-pilot", kind: "directory" },
  ],
  "/home/demo/Projects/visium-pilot": [
    { name: "spatial", path: "/home/demo/Projects/visium-pilot/spatial", kind: "directory" },
    { name: "README.md", path: "/home/demo/Projects/visium-pilot/README.md", kind: "file", size: 1_204 },
  ],
  "/home/demo/Projects/visium-pilot/spatial": [
    { name: "tissue_positions.csv", path: "/home/demo/Projects/visium-pilot/spatial/tissue_positions.csv", kind: "file", size: 312_400 },
  ],
  "/home/demo/projects": [{ name: "example", path: EXAMPLE, kind: "directory" }],
  [EXAMPLE]: [
    { name: "data", path: `${EXAMPLE}/data`, kind: "directory" },
    { name: "figures", path: `${EXAMPLE}/figures`, kind: "directory" },
    { name: "results", path: `${EXAMPLE}/results`, kind: "directory" },
    { name: "samplesheet.csv", path: `${EXAMPLE}/samplesheet.csv`, kind: "file", size: 512 },
  ],
  [`${EXAMPLE}/data`]: [
    { name: "raw", path: `${EXAMPLE}/data/raw`, kind: "directory" },
    { name: "pbmc_qc.h5ad", path: `${EXAMPLE}/data/pbmc_qc.h5ad`, kind: "file", size: 48_211_200 },
  ],
  [`${EXAMPLE}/data/raw`]: [
    { name: "barcodes.tsv.gz", path: `${EXAMPLE}/data/raw/barcodes.tsv.gz`, kind: "file", size: 20_480 },
    { name: "features.tsv.gz", path: `${EXAMPLE}/data/raw/features.tsv.gz`, kind: "file", size: 264_000 },
    { name: "matrix.mtx.gz", path: `${EXAMPLE}/data/raw/matrix.mtx.gz`, kind: "file", size: 4_700_000 },
  ],
  [`${EXAMPLE}/figures`]: [
    { name: "umap_leiden.png", path: `${EXAMPLE}/figures/umap_leiden.png`, kind: "file", size: 182_000 },
  ],
  [`${EXAMPLE}/results`]: [],
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

/** Folders of projects created in the mock, with the scaffold the real server writes. */
function createdTree(): Record<string, FsEntry[]> {
  const tree: Record<string, FsEntry[]> = {};
  let projects: { path: string }[] = [];
  try { projects = Object.values(readDb().projects); } catch { projects = []; }
  for (const { path } of projects) {
    if (TREE[path]) continue;
    tree[path] = PROJECT_SCAFFOLD.map((name) => ({ name, path: `${path}/${name}`, kind: "directory" as const }));
    for (const name of PROJECT_SCAFFOLD) tree[`${path}/${name}`] = [];
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const siblings = tree[parent] ?? [...(TREE[parent] ?? [])];
    if (!siblings.some((entry) => entry.path === path)) siblings.push({ name: path.slice(parent.length + 1), path, kind: "directory" });
    tree[parent] = siblings.sort((a, b) => a.name.localeCompare(b.name));
  }
  return tree;
}

export const knownDirectory = (path: string) => path in TREE || path in createdTree();

export const fsHandlers = [
  http.get("/api/fs/list", ({ request }) => {
    const tree = { ...TREE, ...createdTree() };
    const requested = new URL(request.url).searchParams.get("path") ?? "/home/demo";
    const up = requested.slice(0, requested.lastIndexOf("/"));
    const path = tree[requested] ? requested : up in tree ? up : "/home/demo";
    const parent = path === "/home/demo" ? "/home" : path.slice(0, path.lastIndexOf("/"));
    return HttpResponse.json<FsListing>({ path, parent: path === "/home" ? undefined : parent, entries: tree[path] ?? [], home: "/home/demo" });
  }),
];
