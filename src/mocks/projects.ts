import { delay, http, HttpResponse } from "msw";

import { folderName, joinProjectPath, normalizeProjectPath, projectIdForPath, projectNameError, sortRecent, touchProject } from "@/features/workspace/projects";
import type { CreateProjectRequest, OpenProjectRequest, Project, ProjectList } from "@/features/workspace/types";
import { readDb, writeDb } from "./db";
import { knownDirectory } from "./fs";

const fail = (message: string, status: number) => HttpResponse.json({ message }, { status });

function list(): ProjectList {
  const db = readDb();
  const projects = sortRecent(Object.values(db.projects));
  return { projects, current: db.currentProject && db.projects[db.currentProject] ? db.currentProject : undefined };
}

function remember(project: Project): Project {
  const now = new Date().toISOString();
  const next = touchProject(Object.values(readDb().projects), project, now).find((item) => item.id === project.id)!;
  writeDb((db) => {
    db.projects[next.id] = next;
    db.currentProject = next.id;
  });
  return next;
}

/** `/api/projects` in the browser. Created folders exist only in this mock: `fs.ts` lists them with the scaffold. */
export const projectHandlers = [
  // The demo has no database from before project folders.
  http.get("/api/projects/legacy", () => HttpResponse.json(null)),
  http.get("/api/projects", async () => {
    await delay(60);
    return HttpResponse.json(list());
  }),

  http.post("/api/projects", async ({ request }) => {
    const body = (await request.json()) as CreateProjectRequest;
    const error = projectNameError(body.name ?? "");
    if (error) return fail(error, 400);
    if (!body.parent?.startsWith("/")) return fail("位置必须是绝对路径", 400);
    const path = joinProjectPath(body.parent, body.name);
    if (knownDirectory(path)) return fail(`${path} 已存在且不是空目录，请用「打开目录」`, 409);
    const now = new Date().toISOString();
    await delay(120);
    return HttpResponse.json(remember({ id: projectIdForPath(path), name: body.name.trim(), path, createdAt: now, openedAt: now }), { status: 201 });
  }),

  http.post("/api/projects/open", async ({ request }) => {
    const body = (await request.json()) as OpenProjectRequest;
    const path = normalizeProjectPath(body.path ?? "");
    if (!path.startsWith("/")) return fail("目录必须是绝对路径", 400);
    const known = Object.values(readDb().projects).find((project) => project.path === path);
    if (!known && !knownDirectory(path)) return fail(`目录不存在：${path}`, 404);
    const now = new Date().toISOString();
    return HttpResponse.json(remember(known ?? { id: projectIdForPath(path), name: folderName(path), path, createdAt: now, openedAt: now }));
  }),

  http.post("/api/projects/close", () => {
    writeDb((db) => { db.currentProject = undefined; });
    return HttpResponse.json(list());
  }),

  http.post("/api/projects/:id/open", ({ params }) => {
    const project = readDb().projects[params.id as string];
    if (!project) return fail("项目不在最近列表里", 404);
    return HttpResponse.json(remember(project));
  }),

  http.delete("/api/projects/:id", ({ params }) => {
    const id = params.id as string;
    if (!readDb().projects[id]) return fail("项目不在最近列表里", 404);
    writeDb((db) => {
      delete db.projects[id];
      if (db.currentProject === id) db.currentProject = undefined;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

