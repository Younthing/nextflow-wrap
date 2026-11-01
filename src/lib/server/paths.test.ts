import { describe, expect, it } from "vitest";

import { cacheDirectory, dataDirectory, nextflowCacheEnv, pipelineDirectory, workDirectory } from "./paths";

const none = () => false;

describe("dataDirectory", () => {
  it("honours NEXTFLOW_STUDIO_DATA_DIR", () => {
    expect(dataDirectory({ platform: "darwin", home: "/Users/a", env: { NEXTFLOW_STUDIO_DATA_DIR: "/data/studio" }, exists: none })).toBe("/data/studio");
  });

  it("uses Application Support on macOS", () => {
    expect(dataDirectory({ platform: "darwin", home: "/Users/a", env: {}, exists: none })).toBe("/Users/a/Library/Application Support/Nextflow Studio");
  });

  it("keeps an existing macOS database in the earlier location", () => {
    const exists = (path: string) => path === "/Users/a/.local/share/nextflow-studio/studio.sqlite";
    expect(dataDirectory({ platform: "darwin", home: "/Users/a", env: {}, exists })).toBe("/Users/a/.local/share/nextflow-studio");
  });

  it("follows XDG on Linux", () => {
    expect(dataDirectory({ platform: "linux", home: "/home/a", env: {}, exists: none })).toBe("/home/a/.local/share/nextflow-studio");
    expect(dataDirectory({ platform: "linux", home: "/home/a", env: { XDG_DATA_HOME: "/xdg" }, exists: none })).toBe("/xdg/nextflow-studio");
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
  const input = { platform: "linux" as const, home: "/home/a", env: {}, exists: none };

  it("gives each workflow one stable project directory and all runs one work directory", () => {
    expect(pipelineDirectory("hostchain", input)).toBe("/home/a/.local/share/nextflow-studio/pipelines/hostchain");
    expect(workDirectory(input)).toBe("/home/a/.local/share/nextflow-studio/work");
  });

  it("hashes workflow ids that are not safe directory names", () => {
    const path = pipelineDirectory("../../etc", input);
    expect(path).toMatch(/\/pipelines\/wf-[0-9a-f]{16}$/);
    expect(pipelineDirectory("../../etc", input)).toBe(path);
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
