import { cp, lstat, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { numberedName } from "./upload";

/**
 * Rename, delete, copy and move inside one project folder, for the workbench's file area. Every path is relative
 * to the project folder (`data/counts.tsv`, `""` for the folder itself) and must stay inside it, symlinks included.
 */
export class FsEntryError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

/** Splits a workspace path into segments, refusing `..`, absolute paths and control characters. */
export function workspaceSegments(path: string): string[] {
  if (isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path)) throw new FsEntryError(400, "路径需要相对于项目文件夹");
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length > 64 || segments.some((segment) => segment === ".." || segment.length > 255 || /[\u0000-\u001f]/.test(segment))) {
    throw new FsEntryError(400, "路径无效");
  }
  return segments;
}

/** A file or folder name the user typed. */
export function entryNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "名称不能为空";
  if (trimmed === "." || trimmed === "..") return "名称无效";
  if (/[\\/]/.test(trimmed)) return "名称不能包含 / 或 \\";
  if (/[\u0000-\u001f]/.test(trimmed)) return "名称不能包含控制字符";
  if (trimmed.length > 255) return "名称太长";
  return undefined;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * The absolute path of a workspace entry. Its parent folder, after symlinks, must be inside the project folder; the
 * entry itself is not followed, so a symlink is renamed or deleted as a link.
 */
async function entryPath(root: string, path: string, options: { mustExist?: boolean; allowRoot?: boolean } = {}): Promise<string> {
  const segments = workspaceSegments(path);
  if (!segments.length && !options.allowRoot) throw new FsEntryError(400, "不能对项目文件夹本身这样做");
  const actualRoot = await realpath(root);
  if (!segments.length) return actualRoot;
  const parent = await realpath(join(actualRoot, ...segments.slice(0, -1))).catch((error) => {
    if (missing(error)) throw new FsEntryError(404, `找不到 ${path}`);
    throw error;
  });
  const rel = relative(actualRoot, parent);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new FsEntryError(403, "路径超出项目文件夹");
  const full = join(parent, segments.at(-1)!);
  if (options.mustExist !== false) {
    await lstat(full).catch((error) => {
      if (missing(error)) throw new FsEntryError(404, `找不到 ${path}`);
      throw error;
    });
  }
  return full;
}

const toWorkspace = async (root: string, full: string) => relative(await realpath(root), full).split(sep).join("/");

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, (error) => { if (missing(error)) return false; throw error; });
}

/** Rename an entry in place. Returns its new workspace path. */
export async function renameEntry(root: string, path: string, name: string): Promise<string> {
  const problem = entryNameError(name);
  if (problem) throw new FsEntryError(400, problem);
  const from = await entryPath(root, path);
  const to = join(dirname(from), name.trim());
  if (to === from) return toWorkspace(root, from);
  // A case-only rename on a case-insensitive disk finds the entry itself; that is allowed.
  if (await exists(to) && (await realpath(to)) !== (await realpath(from))) throw new FsEntryError(409, `已有同名的「${name.trim()}」`);
  await rename(from, to);
  return toWorkspace(root, to);
}

/** Delete files and folders, folders with everything in them. */
export async function deleteEntries(root: string, paths: string[]): Promise<void> {
  const targets = await Promise.all(paths.map((path) => entryPath(root, path)));
  for (const target of targets) await rm(target, { recursive: true, force: true });
}

async function freeName(folder: string, name: string, kind: "file" | "directory"): Promise<string> {
  for (let n = 0; n < 1000; n += 1) {
    const candidate = numberedName(name, n, kind);
    if (!(await exists(join(folder, candidate)))) return candidate;
  }
  throw new FsEntryError(409, `「${name}」的副本太多`);
}

/**
 * Paste entries into a folder: `copy` leaves the sources, `move` takes them. A taken name gets a ` (1)` suffix, as an
 * upload does. Moving an entry into the folder it is already in leaves it alone. Returns the new workspace paths.
 */
export async function pasteEntries(root: string, sources: string[], target: string, mode: "copy" | "move"): Promise<string[]> {
  const folder = await entryPath(root, target, { allowRoot: true });
  if (!(await stat(folder).catch(() => undefined))?.isDirectory()) throw new FsEntryError(400, "只能粘贴到文件夹里");
  const actualFolder = await realpath(folder);
  const pasted: string[] = [];
  for (const source of sources) {
    const from = await entryPath(root, source);
    const info = await lstat(from);
    const kind = info.isDirectory() ? "directory" : "file";
    if (kind === "directory") {
      const inside = relative(await realpath(from), actualFolder);
      if (!inside || (!inside.startsWith("..") && !isAbsolute(inside))) throw new FsEntryError(400, `不能把「${basename(from)}」放进它自己里面`);
    }
    if (mode === "move" && dirname(from) === actualFolder) {
      pasted.push(await toWorkspace(root, from));
      continue;
    }
    const to = join(actualFolder, await freeName(actualFolder, basename(from), kind));
    if (mode === "copy") {
      await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    } else {
      try {
        await rename(from, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
        await rm(from, { recursive: true, force: true });
      }
    }
    pasted.push(await toWorkspace(root, to));
  }
  return pasted;
}

/** A new, empty folder. Returns its workspace path. */
export async function createFolder(root: string, parent: string, name: string): Promise<string> {
  const problem = entryNameError(name);
  if (problem) throw new FsEntryError(400, problem);
  const folder = await entryPath(root, parent, { allowRoot: true });
  const to = join(folder, name.trim());
  if (await exists(to)) throw new FsEntryError(409, `已有同名的「${name.trim()}」`);
  await mkdir(to);
  return toWorkspace(root, resolve(to));
}
