import type { ModuleDef } from "@/features/workflow/types";

export const ENV_FIELD_MAX = 500;

export interface ModuleEnvPatch {
  condaYaml?: string;
  containerImage?: string;
}

/** Trim a hand-filled env field. Blank clears it. Newlines would break the process file. */
export function cleanEnvField(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > ENV_FIELD_MAX) throw new Error(`${label}过长`);
  if (/[\u0000-\u001f]/.test(trimmed)) throw new Error(`${label}不能包含换行或控制字符`);
  return trimmed;
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
