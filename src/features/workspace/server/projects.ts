import { mkdir, readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { HttpError } from "@/features/runs/server/service";
import type { StudioStore } from "@/lib/server/database";
import { EXAMPLE_PROJECT_ID, folderName, joinProjectPath, normalizeProjectPath, PROJECT_SCAFFOLD, projectIdForPath, projectNameError, touchProject } from "../projects";
import type { CreateProjectRequest, Project, ProjectList } from "../types";

const CURRENT_KEY = "currentProject";

export interface ProjectContext {
  db: StudioStore;
  /** Folder of the example project, created on demand. */
  exampleDir: string;
  now?: () => string;
}

const timestamp = (context: ProjectContext) => context.now?.() ?? new Date().toISOString();

async function directoryExists(path: string): Promise<boolean> {
  const info = await stat(/* turbopackIgnore: true */ path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  });
  return !!info?.isDirectory();
}

export async function listProjects(context: ProjectContext): Promise<ProjectList> {
  const projects = context.db.projects();
  const current = context.db.meta(CURRENT_KEY);
  return { projects, current: current && projects.some((project) => project.id === current) ? current : undefined };
}

function remember(context: ProjectContext, project: Project): Project {
  const { db } = context;
  const next = touchProject(db.projects(), project, timestamp(context)).find((item) => item.id === project.id)!;
  db.transaction(() => {
    db.saveProject(next);
    db.setMeta(CURRENT_KEY, next.id);
  });
  return next;
}

function absolute(path: string, field: string): string {
  const trimmed = path.trim();
  if (!trimmed || !isAbsolute(trimmed)) throw new HttpError(400, `${field}必须是绝对路径`);
  return normalizeProjectPath(resolve(/* turbopackIgnore: true */ trimmed));
}

/** Make `<parent>/<name>/` with the scaffold folders and open it. An existing non-empty folder is refused. */
export async function createProject(context: ProjectContext, request: CreateProjectRequest): Promise<Project> {
  const error = projectNameError(request.name);
  if (error) throw new HttpError(400, error);
  const parent = absolute(request.parent, "位置");
  if (!(await directoryExists(parent))) throw new HttpError(400, `位置不存在：${parent}`);
  const path = joinProjectPath(parent, request.name);
  if (await directoryExists(path)) {
    const entries = (await readdir(/* turbopackIgnore: true */ path)).filter((name) => !name.startsWith("."));
    if (entries.length) throw new HttpError(409, `${path} 已存在且不是空目录，请用「打开目录」`);
  }
  for (const folder of PROJECT_SCAFFOLD) await mkdir(/* turbopackIgnore: true */ `${path}/${folder}`, { recursive: true });
  const now = timestamp(context);
  const id = projectIdForPath(path);
  return remember(context, { id, name: request.name.trim(), path, createdAt: context.db.project(id)?.createdAt ?? now, openedAt: now });
}

/** Open an existing folder as a project. The same folder always maps to the same project. */
export async function openProject(context: ProjectContext, requested: string): Promise<Project> {
  const path = absolute(requested, "目录");
  const known = context.db.projects().find((project) => project.path === path);
  if (!(await directoryExists(path))) throw new HttpError(404, `目录不存在：${path}`);
  const now = timestamp(context);
  return remember(context, known ?? { id: projectIdForPath(path), name: folderName(path), path, createdAt: now, openedAt: now });
}

/** Re-open a project from the recent list. A folder that was moved or deleted is reported, not silently dropped. */
export async function reopenProject(context: ProjectContext, id: string): Promise<Project> {
  const project = context.db.project(id);
  if (!project) throw new HttpError(404, "项目不在最近列表里");
  if (!(await directoryExists(project.path))) {
    if (project.example) await mkdir(/* turbopackIgnore: true */ project.path, { recursive: true });
    else throw new HttpError(404, `找不到 ${project.path}，可能已移动或删除。可以从列表移除后重新打开目录`);
  }
  return remember(context, project);
}

/** The open project, for new notebooks created without naming one. */
export function currentProjectId(db: StudioStore): string | undefined {
  const id = db.meta(CURRENT_KEY);
  return id && db.project(id) ? id : undefined;
}

export function closeProject(context: ProjectContext) {
  context.db.setMeta(CURRENT_KEY, "");
}

/** Remove from the recent list. The folder on disk is never touched. */
export function forgetProject(context: ProjectContext, id: string) {
  const { db } = context;
  if (!db.project(id)) throw new HttpError(404, "项目不在最近列表里");
  if (id === EXAMPLE_PROJECT_ID) throw new HttpError(400, "示例项目不能移除");
  db.transaction(() => {
    db.deleteProject(id);
    if (db.meta(CURRENT_KEY) === id) db.setMeta(CURRENT_KEY, "");
  });
}
