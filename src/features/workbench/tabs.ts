/**
 * Open notebook tabs of one project. Kept per browser, so reopening a project brings back what was open.
 * The route decides which tab is active; this list only keeps their order.
 */
export const MAX_TABS = 12;

export const tabsPrefKey = (projectId: string) => `nf-studio.workbench.tabs.${projectId}`;

/** Add a tab at the end unless it is already open. The oldest tab drops off past `MAX_TABS`, never the new one. */
export function openTab(tabs: readonly string[], id: string): string[] {
  if (tabs.includes(id)) return [...tabs];
  const next = [...tabs, id];
  return next;
}

/** Close a tab. When it was the active one, the neighbour on the right (else the left) becomes active. */
export function closeTab(tabs: readonly string[], id: string, active: string | undefined): { tabs: string[]; next: string | undefined } {
  const index = tabs.indexOf(id);
  const rest = tabs.filter((tab) => tab !== id);
  if (index < 0 || active !== id) return { tabs: rest, next: active };
  return { tabs: rest, next: rest[index] ?? rest[index - 1] };
}

/** Drop tabs of notebooks that no longer exist in the project. */
export function pruneTabs(tabs: readonly string[], existing: readonly string[]): string[] {
  const known = new Set(existing);
  return tabs.filter((tab) => known.has(tab));
}

/** Parse the `/workbench/[[...path]]` segments. */
export function workbenchView(path: readonly string[] | undefined): { kind: "start" } | { kind: "notebook"; id: string } | { kind: "publish"; id: string } | { kind: "workflow"; id: string } | { kind: "file"; id: string } | { kind: "missing" } {
  if (!path?.length) return { kind: "start" };
  const [id, action, ...rest] = path;
  if ((id === "workflow" || id === "file") && action && !rest.length) return { kind: id, id: id === "file" ? decodeURIComponent(action) : action };
  if (!/^[\w-]{1,80}$/.test(id) || rest.length) return { kind: "missing" };
  if (!action) return { kind: "notebook", id };
  if (action === "publish") return { kind: "publish", id };
  return { kind: "missing" };
}

/** Path segments after `/workbench` from the live URL (client navigations stay in sync). */
export function workbenchPathFromPathname(pathname: string): string[] | undefined {
  if (pathname === "/workbench" || pathname === "/workbench/") return undefined;
  if (!pathname.startsWith("/workbench/")) return undefined;
  const segments = pathname.slice("/workbench/".length).split("/").filter(Boolean);
  return segments.length ? segments : undefined;
}
