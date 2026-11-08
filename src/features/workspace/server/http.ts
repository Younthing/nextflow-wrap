import { ensureExampleProject } from "@/features/notebook/server/http";
import { join } from "node:path";
import { z } from "zod";


import { HttpError } from "@/features/runs/server/service";
import { store, type StudioStore } from "@/lib/server/database";
import { dataDirectory } from "@/lib/server/paths";
import { closeProject, createProject, forgetProject, listProjects, openProject, reopenProject, type ProjectContext } from "./projects";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

const createSchema = z.object({ name: z.string().max(200), parent: z.string().min(1).max(4000) });
const openSchema = z.object({ path: z.string().min(1).max(4000) });
const idPattern = /^[\w-]{1,80}$/;

/**
 * `/api/projects`:
 * - `GET` the recent list and the open project
 * - `POST` create a project folder, `POST /open` open a folder, `POST /:id/open` reopen, `POST /close`
 * - `DELETE /:id` forget it (the folder stays on disk)
 */
export async function handleProjectsApi(method: string, path: string[], request: Request, db: StudioStore = store()): Promise<Response> {
  // The example project is seeded on first use; doing it here makes it show up on a fresh install.

  ensureExampleProject(db);
  const context: ProjectContext = { db, exampleDir: db.workspace ?? join(dataDirectory(), "projects", "example") };
  const [, id, action] = path;
  if (!id && method === "GET") return json(await listProjects(context));
  if (!id && method === "POST") return json(await createProject(context, createSchema.parse(await request.json())), 201);
  if (id === "open" && !action && method === "POST") return json(await openProject(context, openSchema.parse(await request.json()).path));
  if (id === "close" && !action && method === "POST") { closeProject(context); return json(await listProjects(context)); }
  if (id && idPattern.test(id)) {
    if (action === "open" && method === "POST") return json(await reopenProject(context, id));
    if (!action && method === "DELETE") { forgetProject(context, id); return new Response(null, { status: 204 }); }
  }
  throw new HttpError(404, "接口不存在");
}
