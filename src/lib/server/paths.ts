import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Every directory the app writes to comes from here.
 *
 * - The data directory holds app-wide state: the project registry (`workspace-registry.sqlite`), settings, the
 *   example project and the fallback shared work directory. Each project keeps its own runs in `runs/` and its
 *   launch directories and task scratch in `.studio/runtime/` (see docs/project-workbench.md).
 * - The cache directory holds large files that can be rebuilt: conda environments and container images.
 *   Nextflow and the notebook try-run share it, so one `environment.yml` is built once.
 */
export interface PathEnv {
  platform?: NodeJS.Platform;
  home?: string;
  env?: Partial<Record<string, string>>;
}

const context = (input: PathEnv = {}) => ({
  platform: input.platform ?? process.platform,
  home: input.home ?? homedir(),
  env: input.env ?? process.env,
});


export function dataDirectory(input?: PathEnv): string {
  const { platform, home, env } = context(input);
  if (env.NEXTFLOW_STUDIO_DATA_DIR) return resolve(/* turbopackIgnore: true */ env.NEXTFLOW_STUDIO_DATA_DIR);
  if (platform === "darwin") return join(home, "Library/Application Support/Nextflow Studio");
  return join(env.XDG_DATA_HOME ? resolve(env.XDG_DATA_HOME) : join(home, ".local/share"), "nextflow-studio");
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
 * Folder of the example project, laid out like any project: `studio.json`, `notebooks/`, `workflows/`,
 * `modules/`, `runs/` and `.studio/`. Projects the user creates or opens use their own folders. Set
 * `NEXTFLOW_STUDIO_WORKSPACE` to put the example project elsewhere.
 */
export function workspaceDirectory(input?: PathEnv, data?: string): string {
  const { env } = context(input);
  if (env.NEXTFLOW_STUDIO_WORKSPACE) return resolve(/* turbopackIgnore: true */ env.NEXTFLOW_STUDIO_WORKSPACE);
  return join(data ?? dataDirectory(input), "workspaces", "default");
}

/** Shared local work directory for runs outside a project; project runs use `.studio/runtime/work/`. */
export const workDirectory = (input?: PathEnv) => join(dataDirectory(input), "work");

/** Environment for Nextflow child processes. Values the user already set win. */
export function nextflowCacheEnv(env: Partial<Record<string, string>> = process.env, input?: PathEnv): Record<string, string> {
  const singularity = singularityCacheDirectory(input);
  return {
    NXF_CONDA_CACHEDIR: env.NXF_CONDA_CACHEDIR || condaCacheDirectory(input),
    NXF_SINGULARITY_CACHEDIR: env.NXF_SINGULARITY_CACHEDIR || singularity,
    NXF_APPTAINER_CACHEDIR: env.NXF_APPTAINER_CACHEDIR || singularity,
  };
}
