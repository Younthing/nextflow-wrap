import { z } from "zod";

import { guardRequest } from "@/features/desktop/server-guard";
import { store } from "@/lib/server/database";
import { listDirectory } from "./list";
import { reserveUpload, UploadError, writeUpload } from "./upload";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

const reserveSchema = z.object({ project: z.string().min(1).max(200), name: z.string().min(1).max(255), kind: z.enum(["file", "directory"]) });

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
 * - `PUT upload?project=&path=`: stream one file under a reserved name (see `handleUpload`).
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
      return json(await reserveUpload(projectPath(body.project), body.name, body.kind), 201);
    }
  } catch (error) {
    if (error instanceof UploadError) return json({ message: error.message }, error.status);
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
    return json(await writeUpload(projectPath(url.searchParams.get("project")), target, request.body), 201);
  } catch (error) {
    if (error instanceof UploadError) return json({ message: error.message }, error.status);
    throw error;
  }
}
