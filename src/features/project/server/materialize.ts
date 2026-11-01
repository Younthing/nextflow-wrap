import { mkdir, writeFile } from "node:fs/promises";
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
