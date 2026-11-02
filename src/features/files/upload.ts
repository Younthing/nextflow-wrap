import { api, ApiError } from "@/lib/api";

/**
 * Dropped or pasted files for a server that cannot read this computer's paths (a browser, a remote backend).
 * Each top-level item becomes one upload into the project's `data/`: a file, or a folder with everything under it.
 */
export interface UploadItem {
  name: string;
  kind: "file" | "directory";
  /** Files with their path relative to the item (a file item has one entry with path ""). */
  files: { path: string; file: File }[];
}

export interface UploadedItem {
  /** Absolute path on the server. */
  path: string;
  kind: "file" | "directory";
}

export interface UploadProgress {
  loaded: number;
  total: number;
  /** Item being uploaded, 1-based. */
  item: number;
  items: number;
}

type FileEntry = { isFile: true; isDirectory: false; name: string; file: (done: (file: File) => void, fail: (error: unknown) => void) => void };
type DirectoryEntry = { isFile: false; isDirectory: true; name: string; createReader: () => { readEntries: (done: (entries: Entry[]) => void, fail: (error: unknown) => void) => void } };
type Entry = FileEntry | DirectoryEntry;

const fileOf = (entry: FileEntry) => new Promise<File>((done, fail) => entry.file(done, fail));

async function childrenOf(entry: DirectoryEntry): Promise<Entry[]> {
  const reader = entry.createReader();
  const all: Entry[] = [];
  // readEntries returns batches (about 100 in Chrome) until an empty one.
  for (;;) {
    const batch = await new Promise<Entry[]>((done, fail) => reader.readEntries(done, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function walk(entry: Entry, prefix: string, out: UploadItem["files"]) {
  if (entry.isFile) { out.push({ path: prefix + entry.name, file: await fileOf(entry) }); return; }
  for (const child of await childrenOf(entry)) await walk(child, `${prefix}${entry.name}/`, out);
}

/**
 * Items of a drop or paste. Entries must be taken synchronously inside the event handler, so call this before
 * any `await`; the returned promise then reads folders at its own pace.
 */
export function collectItems(transfer: DataTransfer): Promise<UploadItem[]> {
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => (item.webkitGetAsEntry?.() as Entry | null | undefined) ?? undefined);
  const files = Array.from(transfer.files);
  return (async () => {
    if (!entries.length || entries.some((entry) => !entry)) return files.map((file) => ({ name: file.name, kind: "file" as const, files: [{ path: "", file }] }));
    return Promise.all((entries as Entry[]).map(async (entry) => {
      if (entry.isFile) return { name: entry.name, kind: "file" as const, files: [{ path: "", file: await fileOf(entry) }] };
      const files: UploadItem["files"] = [];
      for (const child of await childrenOf(entry)) await walk(child, "", files);
      return { name: entry.name, kind: "directory" as const, files };
    }));
  })();
}

/** Streams one file; XMLHttpRequest because fetch reports no upload progress. */
function put(url: string, file: File, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { done(); return; }
      let message = request.statusText || `上传失败（${request.status}）`;
      try { message = (JSON.parse(request.responseText) as { message?: string }).message ?? message; } catch { /* Not JSON. */ }
      fail(new ApiError(request.status, message));
    };
    request.onerror = () => fail(new Error("上传中断"));
    request.onabort = () => fail(new DOMException("已取消上传", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

const joinPath = (...parts: string[]) => parts.filter(Boolean).join("/");

/** Reserves a free name in `data/` for each item, then uploads its files one after another. */
export async function uploadItems(projectId: string, items: UploadItem[], onProgress: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<UploadedItem[]> {
  const total = items.reduce((sum, item) => sum + item.files.reduce((size, { file }) => size + file.size, 0), 0);
  let done = 0;
  const uploaded: UploadedItem[] = [];
  for (const [index, item] of items.entries()) {
    const reserved = await api<{ name: string; path: string }>("/fs/reserve", { method: "POST", body: JSON.stringify({ project: projectId, name: item.name, kind: item.kind }), signal });
    for (const { path, file } of item.files) {
      const target = joinPath(reserved.name, path);
      const url = `/api/fs/upload?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(target)}`;
      await put(url, file, (loaded) => onProgress({ loaded: done + loaded, total, item: index + 1, items: items.length }), signal);
      done += file.size;
    }
    uploaded.push({ path: reserved.path, kind: item.kind });
  }
  onProgress({ loaded: total, total, item: items.length, items: items.length });
  return uploaded;
}
