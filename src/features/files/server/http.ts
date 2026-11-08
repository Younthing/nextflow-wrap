import { z } from "zod";
import { planReferenceUpdates } from "@/features/workspace/reference-updates";

import { stat } from "node:fs/promises";

import { guardRequest } from "@/features/desktop/server-guard";
import { deleteNotebooks, notebooksAtPaths } from "@/features/notebook/server/http";
import { previewKind, PREVIEW_MAX_BYTES } from "@/features/runs/preview";
import { summarizeAnnData } from "@/features/runs/server/anndata";
import { containedFile, fileResponse } from "@/features/runs/server/files";
import { HttpError } from "@/features/runs/server/service";
import { store } from "@/lib/server/database";
import { createFolder, deleteEntries, FsEntryError, pasteEntries, renameEntry } from "./entries";
import { listDirectory } from "./list";
import { reserveUpload, UploadError, writeUpload } from "./upload";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

const reserveSchema = z.object({ project: z.string().min(1).max(200), name: z.string().min(1).max(255), kind: z.enum(["file", "directory"]), parent: z.string().max(4000).optional() });
const project = z.string().min(1).max(200);
const workspacePath = z.string().max(4000);
const renameSchema = z.object({ project, path: workspacePath.min(1), name: z.string().min(1).max(255) });
const deleteSchema = z.object({ project, paths: z.array(workspacePath.min(1)).min(1).max(500) });
const pasteSchema = z.object({ project, sources: z.array(workspacePath.min(1)).min(1).max(500), target: workspacePath, mode: z.enum(["copy", "move"]) });
const folderSchema = z.object({ project, parent: workspacePath, name: z.string().min(1).max(255) });

/** A notebook stays one while its file is directly in `notebooks/`. */
const notebookFile = (path: string) => /\.ipynb$/.test(path);

function crossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return Boolean(site && site !== "same-origin" && site !== "none");
}

function projectPath(id: string | null): string {
  const project = id ? store().project(id) : undefined;
  if (!project) throw new UploadError(404, "项目不存在");
  return project.path;
}

/**
 * `/api/fs/*` for the machine this server runs on:
 * - `GET list?path=`: folder listing for the web path picker;
 * - `POST reserve` `{project, name, kind}`: claim a free top-level name in the project's `data/`;
 * - `PUT upload?project=&path=`: stream one file under a reserved name (see `handleUpload`);
 * - `GET content?project=&path=[&download=1]`, `GET summary?project=&path=`: a project file, to preview or save;
 * - `POST rename` `{project, path, name}`, `POST delete` `{project, paths}`, `POST paste` `{project, sources, target,
 *   mode}`, `POST folder` `{project, parent, name}`: the file area's actions. Paths are relative to the project folder.
 *   Deleting or moving a notebook's `.ipynb` out of `notebooks/` deletes the notebook too.
 */
export async function handleFsApi(method: string, path: string[], request: Request): Promise<Response> {
  if (crossSite(request)) return json({ message: "不允许跨站访问本机文件" }, 403);
  try {
    if (method === "GET" && path[1] === "list") {
      const url = new URL(request.url);
      return json(await listDirectory(url.searchParams.get("path"), { showHidden: url.searchParams.get("hidden") === "1" }));
    }
    if (method === "POST" && path[1] === "reserve") {
      const body = reserveSchema.parse(await request.json());
      return json(await reserveUpload(projectPath(body.project), body.name, body.kind, body.parent), 201);
    }
    if (method === "GET" && (path[1] === "content" || path[1] === "summary")) {
      const url = new URL(request.url);
      const file = await containedFile(projectPath(url.searchParams.get("project")), url.searchParams.get("path") ?? "");
      if (path[1] === "summary") {
        if (previewKind(file) !== "anndata") return json({ message: "只有 .h5ad 文件有摘要" }, 400);
        return json(await summarizeAnnData(file));
      }
      const download = url.searchParams.get("download") === "1";
      if (!download && (await stat(file)).size > PREVIEW_MAX_BYTES) return json({ message: "文件较大，请下载查看" }, 413);
      return fileResponse(file, download);
    }
    if (method === "POST" && path[1] === "rename") {
      const body = renameSchema.parse(await request.json());
      const db = store();
      const notebooks = await notebooksAtPaths(db, body.project, [body.path]);
      const renamed = await renameEntry(projectPath(body.project), body.path, body.name);
      db.documents?.moved([{ from: body.path, to: renamed }]);
      if (!db.documents && !notebookFile(renamed)) await deleteNotebooks(db, notebooks);
      return json({ path: renamed, referenceUpdates: db.documents ? planReferenceUpdates(db.workflows(), [{ from: body.path, to: renamed }]) : [] });
    }
    if (method === "POST" && path[1] === "delete") {
      const body = deleteSchema.parse(await request.json());
      const db = store();
      const notebooks = await notebooksAtPaths(db, body.project, body.paths);
      await deleteEntries(projectPath(body.project), body.paths);
      await deleteNotebooks(db, notebooks);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path[1] === "paste") {
      const body = pasteSchema.parse(await request.json());
      const db = store();
      const moved = body.mode === "move" ? await notebooksAtPaths(db, body.project, body.sources) : [];
      const pasted = await pasteEntries(projectPath(body.project), body.sources, body.target, body.mode);
      if (body.mode === "move") db.documents?.moved(body.sources.map((from, index) => ({ from, to: pasted[index] })));
      if (!db.documents && moved.length && !pasted.every(notebookFile)) await deleteNotebooks(db, moved);
      return json({ paths: pasted, referenceUpdates: db.documents && body.mode === "move" ? planReferenceUpdates(db.workflows(), body.sources.map((from, index) => ({ from, to: pasted[index] }))) : [] });
    }
    if (method === "POST" && path[1] === "folder") {
      const body = folderSchema.parse(await request.json());
      return json({ path: await createFolder(projectPath(body.project), body.parent, body.name) }, 201);
    }
  } catch (error) {
    if (error instanceof UploadError || error instanceof FsEntryError || error instanceof HttpError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ message: "请求无效" }, 400);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return json({ message: "文件不存在" }, 404);
    throw error;
  }
  return json({ message: "接口不存在" }, 404);
}

/**
 * `PUT /api/fs/upload?project=&path=`. The proxy skips this route so the body streams instead of being buffered,
 * which means the session and origin checks happen here.
 */
export async function handleUpload(request: Request): Promise<Response> {
  const verdict = guardRequest(request);
  if (!verdict.ok) return json({ message: verdict.reason }, verdict.status);
  const origin = request.headers.get("origin");
  const expected = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (crossSite(request) || (origin && origin !== expected)) return json({ message: "不允许跨站上传" }, 403);
  if (request.method !== "PUT") return json({ message: "接口不存在" }, 404);
  const url = new URL(request.url);
  try {
    const target = url.searchParams.get("path");
    if (!target) throw new UploadError(400, "缺少上传路径");
    return json(await writeUpload(projectPath(url.searchParams.get("project")), target, request.body, undefined, url.searchParams.get("parent") ?? undefined), 201);
  } catch (error) {
    if (error instanceof UploadError) return json({ message: error.message }, error.status);
    throw error;
  }
}
