import { http, HttpResponse } from "msw";

import type { FsEntry, FsListing } from "@/features/files/types";
import { exampleData } from "@/features/notebook/examples";
import { contentTypeOf } from "@/features/runs/preview";
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
  // The example project: its data, as src/features/notebook/examples.ts writes it.
  [EXAMPLE]: [
    { name: "data", path: `${EXAMPLE}/data`, kind: "directory" },
    { name: "results", path: `${EXAMPLE}/results`, kind: "directory" },
  ],
  [`${EXAMPLE}/data`]: [
    { name: "counts.tsv", path: `${EXAMPLE}/data/counts.tsv`, kind: "file", size: 14_000 },
    { name: "samples.csv", path: `${EXAMPLE}/data/samples.csv`, kind: "file", size: 140 },
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

/**
 * The demo's file system: the fixed tree plus project folders, changed in memory by uploads and by the file area's
 * rename, delete, copy and move. Paths removed in the demo stay removed even if a project scaffold lists them.
 */
let liveTree: Record<string, FsEntry[]> | null = null;
const deleted = new Set<string>();
/** Bytes of files the demo can show: the example data, uploads and their copies. */
const contents = new Map<string, Uint8Array>();

function live(): Record<string, FsEntry[]> {
  if (!liveTree) {
    liveTree = structuredClone(TREE);
    const encoder = new TextEncoder();
    for (const file of exampleData()) contents.set(`${EXAMPLE}/${file.path}`, encoder.encode(file.content));
  }
  const tree = liveTree;
  for (const [dir, entries] of Object.entries(createdTree())) {
    if (deleted.has(dir)) continue;
    const list = (tree[dir] ??= []);
    for (const entry of entries) if (!deleted.has(entry.path) && !list.some((known) => known.path === entry.path)) list.push({ ...entry });
    list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  }
  return tree;
}

export const knownDirectory = (path: string) => path in TREE || path in createdTree();

const parentDir = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

function findEntry(path: string): FsEntry | undefined {
  return live()[parentDir(path)]?.find((entry) => entry.path === path);
}

function addEntry(path: string, kind: FsEntry["kind"], size?: number) {
  const tree = live();
  const dir = parentDir(path);
  deleted.delete(path);
  const list = (tree[dir] ??= []);
  if (!list.some((entry) => entry.path === path)) list.push({ name: path.slice(dir.length + 1), path, kind, ...(size !== undefined ? { size } : {}) });
  list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  if (kind === "directory") tree[path] ??= [];
}

function removeEntry(path: string) {
  const tree = live();
  const dir = parentDir(path);
  tree[dir] = (tree[dir] ?? []).filter((entry) => entry.path !== path);
  for (const key of Object.keys(tree)) if (key === path || key.startsWith(`${path}/`)) delete tree[key];
  for (const key of [...contents.keys()]) if (key === path || key.startsWith(`${path}/`)) contents.delete(key);
  deleted.add(path);
}

/** Copy an entry, and a folder's whole subtree, to a new path. */
function copyEntry(from: string, to: string) {
  const entry = findEntry(from);
  if (!entry) return;
  addEntry(to, entry.kind, entry.size);
  const bytes = contents.get(from);
  if (bytes) contents.set(to, bytes);
  if (entry.kind === "directory") for (const child of [...(live()[from] ?? [])]) copyEntry(child.path, `${to}/${child.name}`);
}

function addUpload(path: string, kind: FsEntry["kind"], size?: number) {
  addEntry(path, kind, size);
}

function numbered(name: string, n: number, kind: FsEntry["kind"]) {
  if (n === 0) return name;
  const dot = kind === "file" && name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

const fail = (message: string, status: number) => HttpResponse.json({ message }, { status });

/** A project's folder and an absolute path for one of its workspace paths. */
function projectEntry(projectId: string | null | undefined, path = "") {
  const project = projectId ? readDb().projects[projectId] : undefined;
  if (!project) return { error: fail("项目不存在", 404) } as const;
  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) return { error: fail("路径无效", 400) } as const;
  return { root: project.path, full: segments.length ? `${project.path}/${segments.join("/")}` : project.path } as const;
}

const relativeTo = (root: string, full: string) => full.slice(root.length + 1);

export const fsHandlers = [
  http.get("/api/fs/list", ({ request }) => {
    const tree = live();
    const requested = new URL(request.url).searchParams.get("path") ?? "/home/demo";
    const up = requested.slice(0, requested.lastIndexOf("/"));
    const path = tree[requested] ? requested : up in tree ? up : "/home/demo";
    const parent = path === "/home/demo" ? "/home" : path.slice(0, path.lastIndexOf("/"));
    return HttpResponse.json<FsListing>({ path, parent: path === "/home" ? undefined : parent, entries: tree[path] ?? [], home: "/home/demo" });
  }),
  // Upload into the project's data/: a free top-level name first, then the bytes.
  http.post("/api/fs/reserve", async ({ request }) => {
    const body = await request.json() as { project: string; name: string; kind: FsEntry["kind"] };
    const project = readDb().projects[body.project];
    if (!project) return HttpResponse.json({ message: "项目不存在" }, { status: 404 });
    const data = `${project.path}/data`;
    const taken = new Set((live()[data] ?? []).map((entry) => entry.name));
    let name = body.name;
    for (let n = 1; taken.has(name); n++) name = numbered(body.name, n, body.kind);
    addUpload(`${data}/${name}`, body.kind, body.kind === "file" ? 0 : undefined);
    return HttpResponse.json({ name, path: `${data}/${name}` }, { status: 201 });
  }),
  http.put("/api/fs/upload", async ({ request }) => {
    const url = new URL(request.url);
    const project = readDb().projects[url.searchParams.get("project") ?? ""];
    if (!project) return HttpResponse.json({ message: "项目不存在" }, { status: 404 });
    const buffer = await request.arrayBuffer();
    const path = `${project.path}/data/${url.searchParams.get("path")}`;
    for (let dir = parentDir(path); dir.length > project.path.length + "/data".length && !findEntry(dir); dir = parentDir(dir)) addEntry(dir, "directory");
    removeEntry(path);
    addUpload(path, "file", buffer.byteLength);
    // Keep small files so the demo can preview them.
    if (buffer.byteLength <= 10 * 1024 ** 2) contents.set(path, new Uint8Array(buffer));
    return HttpResponse.json({ path, bytes: buffer.byteLength }, { status: 201 });
  }),
  http.get("/api/fs/content", ({ request }) => {
    const url = new URL(request.url);
    const target = projectEntry(url.searchParams.get("project"), url.searchParams.get("path") ?? "");
    if ("error" in target) return target.error;
    const entry = findEntry(target.full);
    if (!entry || entry.kind !== "file") return fail("文件不存在", 404);
    const bytes = contents.get(target.full);
    if (!bytes) return fail("演示环境里没有这个文件的内容", 404);
    const download = url.searchParams.get("download") === "1";
    return new HttpResponse(bytes.slice().buffer, {
      headers: { "content-type": contentTypeOf(target.full), "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(entry.name)}` },
    });
  }),
  http.get("/api/fs/summary", () => fail("演示环境不读取 .h5ad 摘要", 400)),
  http.post("/api/fs/rename", async ({ request }) => {
    const body = await request.json() as { project: string; path: string; name: string };
    const target = projectEntry(body.project, body.path);
    if ("error" in target) return target.error;
    const name = body.name.trim();
    if (!name || /[\\/]/.test(name) || name === "." || name === "..") return fail("名称无效", 400);
    if (target.full === target.root || !findEntry(target.full)) return fail(`找不到 ${body.path}`, 404);
    const to = `${parentDir(target.full)}/${name}`;
    if (to !== target.full && findEntry(to)) return fail(`已有同名的「${name}」`, 409);
    if (to !== target.full) {
      copyEntry(target.full, to);
      removeEntry(target.full);
    }
    return HttpResponse.json({ path: relativeTo(target.root, to) });
  }),
  http.post("/api/fs/delete", async ({ request }) => {
    const body = await request.json() as { project: string; paths: string[] };
    for (const path of body.paths) {
      const target = projectEntry(body.project, path);
      if ("error" in target) return target.error;
      if (target.full === target.root) return fail("不能删除项目文件夹本身", 400);
      removeEntry(target.full);
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("/api/fs/paste", async ({ request }) => {
    const body = await request.json() as { project: string; sources: string[]; target: string; mode: "copy" | "move" };
    const folder = projectEntry(body.project, body.target);
    if ("error" in folder) return folder.error;
    if (folder.full !== folder.root && findEntry(folder.full)?.kind !== "directory") return fail("只能粘贴到文件夹里", 400);
    const pasted: string[] = [];
    for (const source of body.sources) {
      const from = projectEntry(body.project, source);
      if ("error" in from) return from.error;
      const entry = findEntry(from.full);
      if (!entry) return fail(`找不到 ${source}`, 404);
      if (entry.kind === "directory" && (folder.full === from.full || folder.full.startsWith(`${from.full}/`))) return fail(`不能把「${entry.name}」放进它自己里面`, 400);
      if (body.mode === "move" && parentDir(from.full) === folder.full) { pasted.push(source); continue; }
      const taken = new Set((live()[folder.full] ?? []).map((known) => known.name));
      let name = entry.name;
      for (let n = 1; taken.has(name); n++) name = numbered(entry.name, n, entry.kind);
      const to = `${folder.full}/${name}`;
      copyEntry(from.full, to);
      if (body.mode === "move") removeEntry(from.full);
      pasted.push(relativeTo(folder.root, to));
    }
    return HttpResponse.json({ paths: pasted });
  }),
  http.post("/api/fs/folder", async ({ request }) => {
    const body = await request.json() as { project: string; parent: string; name: string };
    const parent = projectEntry(body.project, body.parent);
    if ("error" in parent) return parent.error;
    const name = body.name.trim();
    if (!name || /[\\/]/.test(name)) return fail("名称无效", 400);
    const to = `${parent.full}/${name}`;
    if (findEntry(to)) return fail(`已有同名的「${name}」`, 409);
    addEntry(to, "directory");
    return HttpResponse.json({ path: relativeTo(parent.root, to) }, { status: 201 });
  }),
];
