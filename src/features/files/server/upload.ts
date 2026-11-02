import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Files dropped or pasted into a page whose server runs elsewhere (WSL, a remote machine) are uploaded into the
 * project's `data/` folder. A drop first reserves a free top-level name (`reads.fq`, `reads (1).fq`, a folder name),
 * then streams each file to a path under it.
 */
export const UPLOAD_FOLDER = "data";

export class UploadError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413, message: string) {
    super(message);
  }
}

/** Largest single upload. `NEXTFLOW_STUDIO_UPLOAD_MAX_BYTES` overrides it. */
export function uploadLimit(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.NEXTFLOW_STUDIO_UPLOAD_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 50 * 1024 ** 3;
}

/** Splits a client-supplied relative path into safe segments, or throws. Accepts `/` and `\` separators. */
export function uploadSegments(path: string): string[] {
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== "");
  if (!segments.length || segments.length > 64) throw new UploadError(400, "上传路径无效");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.length > 255 || /[\u0000-\u001f]/.test(segment)) throw new UploadError(400, "上传路径无效");
  }
  return segments;
}

/** `name (n).ext` for the n-th clash; folders and dotfiles keep the whole name before the suffix. */
export function numberedName(name: string, n: number, kind: "file" | "directory"): string {
  if (n === 0) return name;
  const ext = kind === "file" && !name.startsWith(".") ? extname(name) : "";
  return `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
}

async function dataRoot(projectPath: string): Promise<string> {
  const root = join(projectPath, UPLOAD_FOLDER);
  await mkdir(root, { recursive: true });
  return realpath(root);
}

/** Resolves `segments` under `root` and checks that the existing parent (after symlinks) is still inside it. */
async function inside(root: string, segments: string[]): Promise<string> {
  const target = resolve(root, ...segments);
  const parent = await realpath(dirname(target));
  const rel = relative(root, parent);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new UploadError(403, "上传路径超出项目 data/ 目录");
  return target;
}

/** Claims a free top-level name in `data/`: an empty file or folder, created exclusively. */
export async function reserveUpload(projectPath: string, name: string, kind: "file" | "directory"): Promise<{ name: string; path: string }> {
  const segments = uploadSegments(name);
  const requested = segments[0]!;
  if (segments.length !== 1) throw new UploadError(400, "只能保留一个顶层名称");
  const root = await dataRoot(projectPath);
  for (let n = 0; n < 1000; n++) {
    const candidate = numberedName(requested, n, kind);
    const path = join(root, candidate);
    try {
      if (kind === "directory") await mkdir(path);
      else await (await open(path, "wx")).close();
      return { name: candidate, path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new UploadError(409, "同名文件太多");
}

/**
 * Streams `body` to `data/<path>`. The top-level entry must have been reserved first, so an upload never lands
 * on a name the user did not just claim. Bytes go to a temporary sibling that is renamed into place on success.
 */
export async function writeUpload(projectPath: string, path: string, body: ReadableStream<Uint8Array> | null, limit = uploadLimit()): Promise<{ path: string; bytes: number }> {
  if (!body) throw new UploadError(400, "缺少文件内容");
  const segments = uploadSegments(path);
  const root = await dataRoot(projectPath);
  const top = join(root, segments[0]!);
  // A symlinked top-level entry resolves elsewhere and is refused like a missing reservation.
  const reserved = await realpath(top).catch(() => undefined);
  if (!reserved || relative(root, reserved) !== segments[0]) throw new UploadError(409, "请先保留上传名称");
  if (segments.length > 1) await mkdir(dirname(join(root, ...segments)), { recursive: true });
  const target = await inside(root, segments);
  const temporary = join(dirname(target), `.${basename(target)}.${randomBytes(4).toString("hex")}.part`);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > limit) done(new UploadError(413, `文件超过上限 ${Math.round(limit / 1024 ** 3)} GB`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), counter, createWriteStream(temporary, { flags: "wx" }));
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { path: target, bytes };
}
