import { shutdownProjectKernels } from "@/features/notebook/server/kernels";

const registry = globalThis as typeof globalThis & { studioProjectLeases?: Map<string, { count: number; timer?: ReturnType<typeof setTimeout> }> };
const leases = registry.studioProjectLeases ??= new Map();

/** Reconnects have a grace period; only the last window releases a project's kernels. */
export function retainProject(project: string): () => void {
  const lease = leases.get(project) ?? { count: 0 };
  clearTimeout(lease.timer);
  lease.count++;
  leases.set(project, lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lease.count) return;
    lease.timer = setTimeout(() => {
      if (lease.count) return;
      leases.delete(project);
      shutdownProjectKernels(project);
    }, 10_000);
    lease.timer.unref?.();
  };
}
