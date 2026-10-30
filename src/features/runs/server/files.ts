import { createReadStream } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import type { StoredExecution } from "@/lib/server/database";
import type { ResultFile } from "../outputs";
import { HttpError } from "./service";

export async function containedFile(root: string, path: string) {
  const actualRoot = await realpath(root);
  const actual = await realpath(resolve(root, path));
  const rel = relative(actualRoot, actual);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !(await stat(actual)).isFile()) throw new HttpError(403, "文件路径超出允许范围");
  return actual;
}
export async function readTail(path: string, maxBytes = 128_000) {
  const file = await open(path, "r").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!file) return "";
  try {
    const size = (await file.stat()).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return start ? `[仅显示最后 ${maxBytes} 字节，可下载完整日志]\n${text.slice(text.indexOf("\n") + 1)}` : text;
  } finally { await file.close(); }
}
export async function resultFiles(run: StoredExecution): Promise<ResultFile[]> {
  const root = String(run.detail.params.outdir);
  const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const files: ResultFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || files.length >= 10_000) continue;
    const path = relative(root, join(entry.parentPath, entry.name));
    const actual = await containedFile(root, path);
    const size = (await stat(actual)).size;
    const node = run.detail.workflow.nodes.find((node) => path.startsWith(`${node.data.alias.toLowerCase()}/`));
    files.push({ path, size, nodeId: node?.id, preview: size > 10 * 1024 ** 2 ? null : /\.html$/i.test(path) ? "html" : /\.(txt|log|tsv|csv|json|ya?ml|out|summary|stats|metrics)$/i.test(path) ? "text" : null });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function fileResponse(path: string, download: boolean) {
  const type = /\.html$/i.test(path) ? "text/html" : /\.json$/i.test(path) ? "application/json" : /\.(txt|log|tsv|csv|ya?ml)$/i.test(path) ? "text/plain" : "application/octet-stream";
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: { "content-type": `${type}${type.startsWith("text/") ? "; charset=utf-8" : ""}`, "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.split("/").at(-1)!)}`, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", "cache-control": "no-store" },
  });
}
