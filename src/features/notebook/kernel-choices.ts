import { DEFAULT_KERNEL, KERNELS, type KernelId, type KernelSpec, type NotebookLanguage } from "./types";

/**
 * Kernels a notebook can pick, for the toolbar picker and the workbench's runtime list alike. A real server offers
 * its installed Jupyter kernelspecs; the in-browser demo offers its seed kernels. A kernel a notebook names that is
 * not installed still shows, marked: the server then runs it on `python3` (see kernel-bridge.ts).
 */
export interface KernelChoice {
  name: string;
  label: string;
  /** Named by a notebook but not installed on the server. */
  missing?: boolean;
}

const specLabel = (spec: Pick<KernelSpec, "name" | "displayName">) => (spec.displayName === spec.name ? spec.name : `${spec.displayName} · ${spec.name}`);

export function kernelChoices(specs: readonly KernelSpec[], options: { demo: boolean; inUse?: readonly string[] }): KernelChoice[] {
  const choices: KernelChoice[] = options.demo ? (Object.keys(KERNELS) as KernelId[]).map((name) => ({ name, label: KERNELS[name].label })) : [];
  for (const spec of specs) if (!choices.some((choice) => choice.name === spec.name)) choices.push({ name: spec.name, label: specLabel(spec) });
  for (const name of options.inUse ?? []) {
    if (!name || choices.some((choice) => choice.name === name)) continue;
    choices.push({ name, label: name in KERNELS ? KERNELS[name as KernelId].label : name, missing: !options.demo });
  }
  return choices;
}

/** Kernel for a new notebook: the demo's seed kernels, or the standard Jupyter names on a real server. */
export function defaultKernel(language: NotebookLanguage, demo: boolean): string {
  if (demo) return language === "r" ? "r-deseq2" : "py311-pandas";
  return DEFAULT_KERNEL[language];
}
