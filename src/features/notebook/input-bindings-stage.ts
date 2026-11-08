import { copyFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { ConvertError } from "./convert";
import { bindingLine, type InputPlan, safeUploadName } from "./input-bindings";
import type { TryRunInputBinding } from "./types";

export const MAX_COPY_BYTES = Number.POSITIVE_INFINITY;

export interface StagedInputs {
  values: Record<string, string>;
  records: TryRunInputBinding[];
  lines: string[];
}

const inDir = (dir: string, name: string) => join(/* turbopackIgnore: true */ dir, name);

function assertFlat(name: string) {
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new ConvertError(`试跑文件名无效：${name}`);
  }
}

function allocateName(used: Set<string>, preferred: string): string {
  const base = safeUploadName(preferred);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let index = 2;
  let name = `${stem}_${index}${ext}`;
  while (used.has(name)) {
    index += 1;
    name = `${stem}_${index}${ext}`;
  }
  used.add(name);
  return name;
}

/**
 * Copy one typed path into the work directory. A relative path is read from the project workspace,
 * the folder the notebook cells run in, so `data/sample.csv` means the same file in both.
 * A folder is passed by its absolute path. A path that does not exist fails here, before anything runs.
 */
async function copyHostFile(
  dir: string,
  token: string,
  used: Set<string>,
  maxCopyBytes: number,
  workspace: string | undefined,
): Promise<string> {
  if (!token || token.includes("\0")) throw new ConvertError(`路径无效：${token}`);
  const relative = !isAbsolute(token);
  const source = relative && workspace ? resolve(/* turbopackIgnore: true */ workspace, token) : token;
  let info;
  try {
    info = await stat(source);
  } catch {
    throw new ConvertError(relative && workspace ? `工作区里没有 ${token}（${source}）` : `找不到文件：${token}`);
  }
  if (info.isDirectory()) return resolve(source);
  if (!info.isFile()) throw new ConvertError(`路径不是文件：${token}`);
  if (info.size > maxCopyBytes) throw new ConvertError(`路径文件超过 ${Math.round(maxCopyBytes / 1_000_000)} MB，试跑无法复制：${token}`);
  let name: string;
  try {
    name = allocateName(used, token);
  } catch (error) {
    if (error instanceof ConvertError) throw new ConvertError(`路径文件名无效：${token}`);
    throw error;
  }
  try {
    await copyFile(source, inDir(dir, name), constants.COPYFILE_FICLONE);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    throw new ConvertError(`无法读取路径 ${token}${code ? `（${code}）` : ""}`);
  }
  return name;
}

/**
 * Write sample and upload bytes, and copy path bindings into the work directory.
 * `workspace` is the project folder that relative paths are read from.
 */
export async function stageInputPlan(
  dir: string,
  plan: InputPlan,
  reserved: readonly string[] = [],
  options?: { maxCopyBytes?: number; workspace?: string },
): Promise<StagedInputs> {
  const maxCopyBytes = options?.maxCopyBytes ?? MAX_COPY_BYTES;
  const used = new Set<string>(reserved);
  for (const file of plan.files) {
    assertFlat(file.name);
    if (used.has(file.name)) throw new ConvertError(`试跑文件名冲突：${file.name}`);
    used.add(file.name);
  }
  for (const file of plan.files) {
    await writeFile(inDir(dir, file.name), file.bytes);
  }

  const values = { ...plan.values };
  const records = plan.records.map((record) => ({ ...record }));
  for (const path of plan.paths) {
    const staged: string[] = [];
    let copied = false;
    for (const token of path.tokens) {
      const name = await copyHostFile(dir, token, used, maxCopyBytes, options?.workspace);
      staged.push(name);
      if (name !== token) copied = true;
    }
    if (!copied) continue;
    values[path.port] = path.list ? staged.join(",") : staged[0] ?? "";
    const label = path.tokens
      .map((token, index) => (staged[index] !== token ? `${token} → ${staged[index]}` : token))
      .join(", ");
    const record = records.find((item) => item.port === path.port);
    if (record) record.label = label;
  }

  return {
    values,
    records,
    lines: records.map((record) => bindingLine(record.port, record.source, record.label)),
  };
}
