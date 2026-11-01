import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { CondaKind, CondaTool, ContainerKind, ContainerTool, TryRunTools } from "./try-run-env";

export const condaCacheDir = () => join(homedir(), ".cache", "nextflow-wrap", "conda");

function basename(bin: string): string {
  return bin.split(/[/\\]/).pop()?.toLowerCase() ?? "";
}

export function containerKindFromBin(bin: string): ContainerKind {
  const base = basename(bin);
  if (base.startsWith("podman")) return "podman";
  if (base.startsWith("singularity")) return "singularity";
  if (base.startsWith("apptainer")) return "apptainer";
  return "docker";
}

export function condaKindFromBin(bin: string): CondaKind {
  const base = basename(bin);
  if (base.startsWith("micromamba")) return "micromamba";
  if (base.startsWith("mamba")) return "mamba";
  return "conda";
}

async function findOnPath(names: readonly string[]): Promise<string | undefined> {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Try the next directory.
      }
    }
  }
  return undefined;
}

async function overridden(bin: string | undefined, label: string): Promise<string | undefined> {
  if (!bin) return undefined;
  try {
    await access(bin, constants.X_OK);
  } catch {
    throw new Error(`${label} 不可执行：${bin}`);
  }
  return bin;
}

/** Locate conda and a container runtime. `TRY_RUN_*_BIN` overrides PATH lookup. */
export async function discoverTryRunTools(): Promise<TryRunTools> {
  const condaBin = await overridden(process.env.TRY_RUN_CONDA_BIN, "TRY_RUN_CONDA_BIN")
    ?? await findOnPath(["micromamba", "mamba", "conda"]);
  const containerBin = await overridden(process.env.TRY_RUN_CONTAINER_BIN, "TRY_RUN_CONTAINER_BIN")
    ?? await findOnPath(["docker", "podman", "singularity", "apptainer"]);
  const conda: CondaTool | undefined = condaBin ? { bin: condaBin, kind: condaKindFromBin(condaBin) } : undefined;
  const container: ContainerTool | undefined = containerBin
    ? { bin: containerBin, kind: containerKindFromBin(containerBin) }
    : undefined;
  return { conda, container };
}

export async function condaFileProblem(yamlPath: string): Promise<string | undefined> {
  try {
    const info = await stat(yamlPath);
    if (!info.isFile()) return `conda 路径需要是环境 yaml 文件：${yamlPath}`;
  } catch {
    return `找不到 conda 文件：${yamlPath}`;
  }
  return undefined;
}

/** Stable prefix for one yaml body. A changed file gets a new directory. */
export async function condaCachePrefix(yamlPath: string, cacheDir = condaCacheDir()): Promise<string> {
  const body = await readFile(yamlPath);
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 24);
  return join(cacheDir, hash);
}
