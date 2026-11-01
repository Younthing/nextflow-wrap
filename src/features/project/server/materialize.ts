import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ProjectSnapshot } from "@/features/runs/types";

export function projectPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  const rel = relative(resolve(root), resolved);
  if (!rel || isAbsolute(path) || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Invalid project path: ${path}`);
  return resolved;
}

/** Caller supplies a new directory; never overwrite an existing execution. */
export async function materializeProject(project: Pick<ProjectSnapshot, "files">, directory: string): Promise<void> {
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  for (const file of project.files) {
    const path = projectPath(directory, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, { flag: "wx" });
  }
}

/** Lists the files `syncProject` wrote, so a later sync can remove the ones a new version dropped. */
export const PROJECT_MANIFEST = ".studio-files.json";

/**
 * Bring a stable project directory to this snapshot.
 * Unchanged files are left alone so their modification time, and with it Nextflow's task hash, stays the same.
 * Files from an earlier snapshot that this one no longer has are removed; anything else in the directory
 * (`.nextflow/`, user files) is kept.
 */
export async function syncProject(project: Pick<ProjectSnapshot, "files">, directory: string): Promise<{ written: string[]; removed: string[] }> {
  await mkdir(directory, { recursive: true });
  const manifestPath = projectPath(directory, PROJECT_MANIFEST);
  const previous: string[] = await readFile(manifestPath, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .then((value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []))
    .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT" || error instanceof SyntaxError) return []; throw error; });
  const written: string[] = [];
  for (const file of project.files) {
    const path = projectPath(directory, file.path);
    const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (current === file.content) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
    written.push(file.path);
  }
  const keep = new Set(project.files.map((file) => file.path));
  const removed: string[] = [];
  for (const stale of previous) {
    if (keep.has(stale) || stale === PROJECT_MANIFEST) continue;
    await rm(projectPath(directory, stale), { force: true });
    removed.push(stale);
  }
  await writeFile(manifestPath, `${JSON.stringify([...keep].sort(), null, 2)}\n`);
  return { written, removed };
}
