import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { FsEntry, FsListing } from "../types";

const MAX_ENTRIES = 2_000;

/**
 * One folder of the machine the runner uses, for the web file picker. Big inputs (h5ad, 10x folders, ligand
 * libraries) are referenced by path, never uploaded, so the picker only needs names, kinds and sizes.
 * Hidden entries are left out; folders come first.
 */
export async function listDirectory(requested: string | null, options: { home?: string; showHidden?: boolean } = {}): Promise<FsListing> {
  const home = options.home ?? homedir();
  const path = requested && isAbsolute(requested) ? resolve(requested) : home;
  const info = await stat(path);
  const folder = info.isDirectory() ? path : dirname(path);
  const names = await readdir(folder, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const item of names) {
    if (!options.showHidden && item.name.startsWith(".")) continue;
    const full = join(folder, item.name);
    let kind: FsEntry["kind"] | undefined = item.isDirectory() ? "directory" : item.isFile() ? "file" : undefined;
    let size: number | undefined;
    if (item.isSymbolicLink() || item.isFile()) {
      const target = await stat(full).catch(() => undefined);
      if (!target) continue;
      kind = target.isDirectory() ? "directory" : "file";
      if (kind === "file") size = target.size;
    }
    if (!kind) continue;
    entries.push({ name: item.name, path: full, kind, ...(size !== undefined ? { size } : {}) });
    if (entries.length >= MAX_ENTRIES) break;
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  const parent = dirname(folder);
  return { path: folder, parent: parent === folder ? undefined : parent, entries, home };
}
