import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * A workspace is one research project on disk: notebooks, installed modules, pipelines, sample sheets and runs.
 * `studio.json` marks the folder and carries its format version; everything the app keeps privately goes in `.studio/`.
 */
export const WORKSPACE_FORMAT = 1;
export const WORKSPACE_MANIFEST = "studio.json";
export const WORKSPACE_FOLDERS = ["notebooks", "modules", "pipelines", "samplesheets", "runs"] as const;

const GITIGNORE = [
  "# Written by Nextflow Studio. App state, work files and run results stay out of Git.",
  ".studio/",
  "runs/*/results/",
  ".nextflow*",
  "",
].join("\n");

export interface WorkspaceManifest {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: string;
}

export class WorkspaceError extends Error {}

/** Write a file through a temporary name, so readers never see half of it. */
export async function writeFileAtomic(path: string, content: string) {
  const temp = `${path}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(temp, content);
  await rename(temp, path);
}

async function readManifest(root: string): Promise<WorkspaceManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(root, WORKSPACE_MANIFEST), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let value: Partial<WorkspaceManifest>;
  try {
    value = JSON.parse(raw) as Partial<WorkspaceManifest>;
  } catch {
    throw new WorkspaceError(`${WORKSPACE_MANIFEST} 不是有效的 JSON`);
  }
  if (typeof value.formatVersion !== "number" || typeof value.id !== "string") throw new WorkspaceError(`${WORKSPACE_MANIFEST} 缺少 formatVersion 或 id`);
  if (value.formatVersion > WORKSPACE_FORMAT) {
    throw new WorkspaceError(`这个工作区由更新版本的 Nextflow Studio 创建（格式 ${value.formatVersion}），请升级应用后再打开`);
  }
  return {
    formatVersion: value.formatVersion,
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : basename(root),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
  };
}

/** Open a workspace folder, creating its manifest, `.gitignore` and standard folders when they are missing. */
export async function ensureWorkspace(root: string, name = basename(root)): Promise<WorkspaceManifest> {
  await mkdir(root, { recursive: true });
  let manifest = await readManifest(root);
  if (!manifest) {
    manifest = { formatVersion: WORKSPACE_FORMAT, id: `ws_${randomUUID().slice(0, 8)}`, name, createdAt: new Date().toISOString() };
    await writeFileAtomic(join(root, WORKSPACE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  await writeFile(join(root, ".gitignore"), GITIGNORE, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  for (const folder of WORKSPACE_FOLDERS) await mkdir(join(/* turbopackIgnore: true */ root, folder), { recursive: true });
  return manifest;
}
