import { describe, expect, it } from "vitest";

import { cacheDirectory, dataDirectory, nextflowCacheEnv, workDirectory, workspaceDirectory } from "./paths";

describe("dataDirectory", () => {
  it("honours NEXTFLOW_STUDIO_DATA_DIR", () => {
    expect(dataDirectory({ platform: "darwin", home: "/Users/a", env: { NEXTFLOW_STUDIO_DATA_DIR: "/data/studio" } })).toBe("/data/studio");
  });

  it("uses Application Support on macOS", () => {
    expect(dataDirectory({ platform: "darwin", home: "/Users/a", env: {} })).toBe("/Users/a/Library/Application Support/Nextflow Studio");
  });

  it("follows XDG on Linux", () => {
    expect(dataDirectory({ platform: "linux", home: "/home/a", env: {} })).toBe("/home/a/.local/share/nextflow-studio");
    expect(dataDirectory({ platform: "linux", home: "/home/a", env: { XDG_DATA_HOME: "/xdg" } })).toBe("/xdg/nextflow-studio");
  });
});

describe("cacheDirectory", () => {
  it("uses Caches on macOS and XDG on Linux", () => {
    expect(cacheDirectory({ platform: "darwin", home: "/Users/a", env: {} })).toBe("/Users/a/Library/Caches/Nextflow Studio");
    expect(cacheDirectory({ platform: "linux", home: "/home/a", env: {} })).toBe("/home/a/.cache/nextflow-studio");
    expect(cacheDirectory({ platform: "linux", home: "/home/a", env: { XDG_CACHE_HOME: "/xdg-cache" } })).toBe("/xdg-cache/nextflow-studio");
    expect(cacheDirectory({ platform: "linux", home: "/home/a", env: { NEXTFLOW_STUDIO_CACHE_DIR: "/big/cache" } })).toBe("/big/cache");
  });
});

describe("run directories", () => {
  const input = { platform: "linux" as const, home: "/home/a", env: {} };

  it("gives runs outside a project one shared work directory", () => {
    expect(workDirectory(input)).toBe("/home/a/.local/share/nextflow-studio/work");
  });

  it("keeps the example project next to the data, unless pointed elsewhere", () => {
    expect(workspaceDirectory(input)).toBe("/home/a/.local/share/nextflow-studio/workspaces/default");
    expect(workspaceDirectory({ ...input, env: { NEXTFLOW_STUDIO_WORKSPACE: "/projects/pbmc" } })).toBe("/projects/pbmc");
  });
});

describe("nextflowCacheEnv", () => {
  it("points conda and container caches at the shared cache unless already set", () => {
    const input = { platform: "linux" as const, home: "/home/a", env: {} };
    expect(nextflowCacheEnv({}, input)).toEqual({
      NXF_CONDA_CACHEDIR: "/home/a/.cache/nextflow-studio/conda",
      NXF_SINGULARITY_CACHEDIR: "/home/a/.cache/nextflow-studio/singularity",
      NXF_APPTAINER_CACHEDIR: "/home/a/.cache/nextflow-studio/singularity",
    });
    expect(nextflowCacheEnv({ NXF_CONDA_CACHEDIR: "/opt/conda-envs" }, input).NXF_CONDA_CACHEDIR).toBe("/opt/conda-envs");
  });
});
