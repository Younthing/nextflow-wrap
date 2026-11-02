import { kernelChoices } from "@/features/notebook/kernel-choices";
import type { KernelSpec, NotebookSummary } from "@/features/notebook/types";

export interface RuntimeRow {
  name: string;
  label: string;
  /** Notebooks in this project that use it. */
  users: number;
  /** Named by a notebook but not installed on the server. */
  missing?: boolean;
}

/** The kernels the picker offers (kernelChoices), with how many of the project's notebooks use each. */
export function runtimeRows(notebooks: readonly Pick<NotebookSummary, "kernel">[], specs: readonly KernelSpec[], demo: boolean): RuntimeRow[] {
  const count = (name: string) => notebooks.filter((nb) => nb.kernel === name).length;
  return kernelChoices(specs, { demo, inUse: notebooks.map((nb) => nb.kernel) }).map((choice) => ({ ...choice, users: count(choice.name) }));
}
