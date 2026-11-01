import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface DirectorySize { bytes: number; reclaimable: number; files: number; truncated: boolean }

/**
 * Walks a directory without following symlinks. `reclaimable` counts files with a single link: published
 * results are hard links into the work directory, so removing the work copy does not free them.
 */
export async function directorySize(path: string, budget = { files: 200_000 }): Promise<DirectorySize> {
  const total: DirectorySize = { bytes: 0, reclaimable: 0, files: 0, truncated: false };
  const stack = [path];
  while (stack.length) {
    const current = stack.pop()!;
    const info = await lstat(current).catch(() => undefined);
    if (!info) continue;
    if (info.isDirectory()) {
      const names = await readdir(current).catch(() => [] as string[]);
      for (const name of names) stack.push(join(current, name));
      continue;
    }
    if (!info.isFile()) continue;
    total.files++;
    total.bytes += info.size;
    if (info.nlink <= 1) total.reclaimable += info.size;
    if (total.files >= budget.files) { total.truncated = true; break; }
  }
  budget.files -= total.files;
  return total;
}
