import type { ModuleDef } from "@/features/workflow/types";

export const ENV_FIELD_MAX = 500;

export interface ModuleEnvPatch {
  condaYaml?: string;
  containerImage?: string;
}

export class EnvFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvFieldError";
  }
}

/** Trim a hand-filled env field. Blank clears it. Newlines would break the process file. */
export function cleanEnvField(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > ENV_FIELD_MAX) throw new EnvFieldError(`${label}过长`);
  if (/[\u0000-\u001f]/.test(trimmed)) throw new EnvFieldError(`${label}不能包含换行或控制字符`);
  return trimmed;
}

/** Canonical conda / container pair. Blank strings clear the field. */
export function readModuleEnv(env: ModuleEnvPatch): { condaYaml?: string; containerImage?: string } {
  return {
    condaYaml: cleanEnvField(env.condaYaml, "Conda yaml 路径"),
    containerImage: cleanEnvField(env.containerImage, "容器地址"),
  };
}

export function stageModuleEnv(env: ModuleEnvPatch):
  | { ok: true; condaYaml?: string; containerImage?: string }
  | { ok: false; message: string } {
  try {
    return { ok: true, ...readModuleEnv(env) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "环境无效" };
  }
}

function normEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Publish and try-run name the same conda yaml and container image. */
export function sameModuleEnv(
  left: { condaYaml?: string; containerImage?: string },
  right: { condaYaml?: string; containerImage?: string },
): boolean {
  return normEnv(left.condaYaml) === normEnv(right.condaYaml)
    && normEnv(left.containerImage) === normEnv(right.containerImage);
}

/** What try-run will do with the fields the process also receives. */
export function tryRunEnvSummary(env: { condaYaml?: string; containerImage?: string }): string {
  const conda = env.condaYaml?.trim() ?? "";
  const image = env.containerImage?.trim() ?? "";
  if (!conda && !image) {
    return "未填写Conda yaml和容器地址。可以保存，process 省略对应指令。试跑使用本机解释器。";
  }
  if (!conda || !image) {
    const missing = !conda ? "Conda yaml" : "容器地址";
    const used = conda ? `conda ${conda}` : `container ${image}`;
    return `未填写${missing}。process 省略未填的指令。试跑使用已填写的 ${used}。`;
  }
  return `试跑与 process 使用同一份 conda ${conda} 和 container ${image}。本机有容器运行时优先用容器，否则用 conda。`;
}

/** Copy conda / container onto a module. Omitted keys stay as they are; blank strings clear them. */
export function patchModuleEnv(def: ModuleDef, patch: ModuleEnvPatch): ModuleDef {
  return {
    ...def,
    ...(patch.condaYaml !== undefined ? { condaYaml: cleanEnvField(patch.condaYaml, "Conda yaml 路径") } : {}),
    ...(patch.containerImage !== undefined ? { containerImage: cleanEnvField(patch.containerImage, "容器地址") } : {}),
  };
}

export function missingEnvLabels(env: { condaYaml?: string; containerImage?: string }): string[] {
  const missing: string[] = [];
  if (!env.condaYaml?.trim()) missing.push("Conda yaml");
  if (!env.containerImage?.trim()) missing.push("容器地址");
  return missing;
}
