import { KERNELS, kernelLabel, type KernelId, type NotebookSummary } from "@/features/notebook/types";

export interface RuntimeRow {
  name: string;
  label: string;
  /** Notebooks in this project that use it. */
  users: number;
}

/** Built-in kernels, then local Jupyter kernelspecs, then any other kernel a notebook names. */
export function runtimeRows(notebooks: readonly Pick<NotebookSummary, "kernel">[], jupyter: readonly { name: string; displayName: string }[]): RuntimeRow[] {
  const count = (name: string) => notebooks.filter((nb) => nb.kernel === name).length;
  const rows: RuntimeRow[] = (Object.keys(KERNELS) as KernelId[]).map((name) => ({ name, label: KERNELS[name].label, users: count(name) }));
  for (const spec of jupyter) {
    if (rows.some((row) => row.name === spec.name)) continue;
    rows.push({ name: spec.name, label: spec.displayName === spec.name ? spec.name : `${spec.displayName} · ${spec.name}`, users: count(spec.name) });
  }
  for (const nb of notebooks) {
    if (!rows.some((row) => row.name === nb.kernel)) rows.push({ name: nb.kernel, label: kernelLabel(nb.kernel), users: count(nb.kernel) });
  }
  return rows;
}
