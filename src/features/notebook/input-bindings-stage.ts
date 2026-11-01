import { copyFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ConvertError } from "./convert";
import { bindingLine, type InputPlan, safeUploadName } from "./input-bindings";
import type { TryRunInputBinding } from "./types";

export const MAX_COPY_BYTES = 32_000_000;

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

async function copyHostFile(dir: string, token: string, used: Set<string>, maxCopyBytes: number): Promise<string | null> {
  if (!token || token.includes("\0")) return null;
  let info;
  try {
    info = await stat(token);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (info.size > maxCopyBytes) throw new ConvertError(`路径文件超过 ${Math.round(maxCopyBytes / 1_000_000)} MB，试跑无法复制：${token}`);
  let name: string;
  try {
    name = allocateName(used, token);
  } catch (error) {
    if (error instanceof ConvertError) throw new ConvertError(`路径文件名无效：${token}`);
    throw error;
  }
  try {
    await copyFile(token, inDir(dir, name));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    throw new ConvertError(`无法读取路径 ${token}${code ? `（${code}）` : ""}`);
  }
  return name;
}

/** Write sample and upload bytes, and copy path bindings that exist on disk into the work directory. */
export async function stageInputPlan(
  dir: string,
  plan: InputPlan,
  reserved: readonly string[] = [],
  options?: { maxCopyBytes?: number },
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
      const name = await copyHostFile(dir, token, used, maxCopyBytes);
      if (name) {
        staged.push(name);
        if (name !== token) copied = true;
      } else {
        staged.push(token);
      }
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
