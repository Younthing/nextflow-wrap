import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Every directory the app writes to comes from here.
 *
 * - The data directory holds the database, run records and the per-workflow launch directories.
 * - The cache directory holds large files that can be rebuilt: conda environments and container images.
 *   Nextflow and the notebook try-run share it, so one `environment.yml` is built once.
 */
export interface PathEnv {
  platform?: NodeJS.Platform;
  home?: string;
  env?: Partial<Record<string, string>>;
  exists?: (path: string) => boolean;
}

const context = (input: PathEnv = {}) => ({
  platform: input.platform ?? process.platform,
  home: input.home ?? homedir(),
  env: input.env ?? process.env,
  exists: input.exists ?? existsSync,
});

/** Linux and older installs on macOS used this location. */
const legacyDataDirectory = (home: string) => join(home, ".local/share/nextflow-studio");

export function dataDirectory(input?: PathEnv): string {
  const { platform, home, env, exists } = context(input);
  if (env.NEXTFLOW_STUDIO_DATA_DIR) return resolve(/* turbopackIgnore: true */ env.NEXTFLOW_STUDIO_DATA_DIR);
  if (platform === "darwin") {
    const legacy = legacyDataDirectory(home);
    // Keep using a database that an earlier version already wrote; moving it is a separate migration.
    if (exists(join(legacy, "studio.sqlite"))) return legacy;
    return join(home, "Library/Application Support/Nextflow Studio");
  }
  if (env.XDG_DATA_HOME) return join(resolve(env.XDG_DATA_HOME), "nextflow-studio");
  return legacyDataDirectory(home);
}

export function cacheDirectory(input?: PathEnv): string {
  const { platform, home, env } = context(input);
  if (env.NEXTFLOW_STUDIO_CACHE_DIR) return resolve(/* turbopackIgnore: true */ env.NEXTFLOW_STUDIO_CACHE_DIR);
  if (platform === "darwin") return join(home, "Library/Caches/Nextflow Studio");
  return join(env.XDG_CACHE_HOME ? resolve(env.XDG_CACHE_HOME) : join(home, ".cache"), "nextflow-studio");
}

export const condaCacheDirectory = (input?: PathEnv) => join(cacheDirectory(input), "conda");
export const singularityCacheDirectory = (input?: PathEnv) => join(cacheDirectory(input), "singularity");

/**
 * The module library: every published script module, one immutable folder per version,
 * `<namespace>/<name>/<version>/`, next to the database. Set `NEXTFLOW_STUDIO_MODULE_LIBRARY` to share one, for example a team Git checkout.
 */
export function moduleLibraryDirectory(input?: PathEnv, data?: string): string {
  const { env } = context(input);
  if (env.NEXTFLOW_STUDIO_MODULE_LIBRARY) return resolve(/* turbopackIgnore: true */ env.NEXTFLOW_STUDIO_MODULE_LIBRARY);
  return join(data ?? dataDirectory(input), "library", "modules");
}

/** Shared local work directory. Task hashes do not depend on it, so every workflow can use one. */
export const workDirectory = (input?: PathEnv) => join(dataDirectory(input), "work");

/** Run records: parameters, logs, trace, reports, results and a copy of the project that ran. */
export const executionDirectory = (lineageId: string, input?: PathEnv) => join(dataDirectory(input), "executions", lineageId);

/**
 * Stable project and launch directory for one workflow.
 * Nextflow hashes `bin/` scripts by path and modification time, and the generated scripts call
 * `${workflow.projectDir}/bin/...`, so `-resume` only finds cached tasks when the project stays here.
 */
export function pipelineDirectory(workflowId: string, input?: PathEnv): string {
  const safe = /^[A-Za-z0-9_-]{1,80}$/.test(workflowId) ? workflowId : `wf-${createHash("sha256").update(workflowId).digest("hex").slice(0, 16)}`;
  return join(dataDirectory(input), "pipelines", safe);
}

/** Environment for Nextflow child processes. Values the user already set win. */
export function nextflowCacheEnv(env: Partial<Record<string, string>> = process.env, input?: PathEnv): Record<string, string> {
  const singularity = singularityCacheDirectory(input);
  return {
    NXF_CONDA_CACHEDIR: env.NXF_CONDA_CACHEDIR || condaCacheDirectory(input),
    NXF_SINGULARITY_CACHEDIR: env.NXF_SINGULARITY_CACHEDIR || singularity,
    NXF_APPTAINER_CACHEDIR: env.NXF_APPTAINER_CACHEDIR || singularity,
  };
}
