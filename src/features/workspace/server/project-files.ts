import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** A document version is the digest of the exact bytes the editor read. */
export interface FileDocument { path: string; content: string; version: string }
export class ProjectFileError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const contentVersion = (content: string) => createHash("sha256").update(content).digest("hex");
const inside = (root: string, target: string) => {
  const part = relative(root, target);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
};

/** All project mutations pass through this module, including internal metadata writes. */
export class ProjectFiles {
  readonly root: string;
  constructor(root: string) { this.root = realpathSync(root); }

  initialize(): { id: string; formatVersion: number } {
    if (existsSync(join(this.root, "studio.json"))) {
      const manifest = JSON.parse(this.read("studio.json").content);
      if (manifest.formatVersion !== 2 || typeof manifest.id !== "string") throw new ProjectFileError(422, "studio.json 格式无效或版本不受支持");
      return manifest;
    }
    const manifest = { formatVersion: 2, id: randomUUID(), name: this.root.split(/[\\/]/).at(-1) };
    this.write("studio.json", `${JSON.stringify(manifest, null, 2)}\n`, null);
    return manifest;
  }

  resolve(path: string): string {
    if (isAbsolute(path) || path.includes("\0")) throw new ProjectFileError(400, "需要项目相对路径");
    const target = resolve(this.root, path);
    if (!inside(this.root, target)) throw new ProjectFileError(403, "文件操作不能离开项目目录");
    let parent = target;
    while (!existsSync(parent)) {
      // existsSync follows symlinks: refuse dangling links as well.
      try { if (lstatSync(parent).isSymbolicLink()) throw new ProjectFileError(403, "无法操作失效的符号链接"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      parent = dirname(parent);
    }
    if (!inside(this.root, realpathSync(parent))) throw new ProjectFileError(403, "文件操作不能修改项目外的符号链接目标");
    return target;
  }

  read(path: string): FileDocument {
    const target = this.resolve(path);
    if (!existsSync(target)) throw new ProjectFileError(404, "文件已删除或不存在");
    if (statSync(target).size > 16 * 1024 * 1024) throw new ProjectFileError(413, "文件过大，请下载查看");
    const content = readFileSync(target, "utf8");
    return { path, content, version: contentVersion(content) };
  }

  /** null means create-only. A stale editor can never resurrect a deleted file. */
  write(path: string, content: string, expected: string | null): FileDocument {
    const target = this.resolve(path);
    mkdirSync(dirname(target), { recursive: true });
    const lock = `${target}.studio-lock`;
    let fd: number;
    try { fd = openSync(lock, "wx"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ProjectFileError(409, "文件正在保存，请重试");
      throw error;
    }
    const temp = `${target}.tmp-${randomUUID()}`;
    try {
      const current = existsSync(target) ? contentVersion(readFileSync(target, "utf8")) : null;
      if (current !== expected) throw new ProjectFileError(409, current === null ? "文件已删除，请另存为" : "文件在外部被修改，请比较后重新载入或另存为");
      writeFileSync(temp, content, { flag: "wx" });
      // Detect external editors which don't participate in the application lock.
      const latest = existsSync(target) ? contentVersion(readFileSync(target, "utf8")) : null;
      if (latest !== current) throw new ProjectFileError(409, "文件在保存期间被修改");
      renameSync(temp, target);
      return { path, content, version: contentVersion(content) };
    } finally {
      rmSync(temp, { force: true });
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }

  /** Internal records are serialized by the caller's transaction. */
  record(path: string, value: unknown) {
    const target = this.resolve(path);
    const expected = existsSync(target) ? contentVersion(readFileSync(target, "utf8")) : null;
    return this.write(path, `${JSON.stringify(value, null, 2)}\n`, expected);
  }

  list(path = "") {
    return readdirSync(this.resolve(path), { withFileTypes: true })
      .filter((entry) => !entry.name.endsWith(".studio-lock") && !entry.name.includes(".tmp-"))
      .map((entry) => ({ name: entry.name, path: [path, entry.name].filter(Boolean).join("/"), directory: entry.isDirectory(), symlink: entry.isSymbolicLink() }));
  }

  /** Only document discovery recurses. Data, run outputs and execution caches are never scanned. */
  documents(path = ""): string[] {
    const excluded = new Set([".studio", ".git", "node_modules", "data", "results", "runs", "modules", ".ipynb_checkpoints"]);
    return this.list(path).flatMap((entry): string[] => {
      if (entry.symlink || excluded.has(entry.name)) return [];
      if (entry.directory) return this.documents(entry.path);
      return /(?:\.ipynb|\.workflow\.json)$/.test(entry.name) ? [entry.path] : [];
    });
  }

  remove(path: string) {
    if (!path || this.resolve(path) === this.root) throw new ProjectFileError(400, "不能删除项目根目录");
    rmSync(this.resolve(path), { force: true });
  }

  available(folder: string, name: string, extension: string): string {
    const base = name.replace(/[/\\\u0000-\u001f]/g, "-").replace(/^\.+/, "").trim().slice(0, 100) || "Untitled";
    for (let i = 0; ; i++) {
      const path = `${folder ? `${folder}/` : ""}${base}${i ? ` (${i + 1})` : ""}${extension}`;
      if (!existsSync(this.resolve(path))) return path;
    }
  }
}
