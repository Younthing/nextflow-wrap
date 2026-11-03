import { readFile, stat } from "node:fs/promises";

/** Largest conda environment file copied into a module. Real ones are a few hundred bytes. */
const ENVIRONMENT_MAX = 256 * 1024;

/** Contents of the conda file a module names, so the module can carry its own `environment.yml`. */
export async function readEnvironmentYml(path: string | undefined): Promise<string | undefined> {
  if (!path?.trim()) return undefined;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > ENVIRONMENT_MAX) return undefined;
    return (await readFile(path, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}
