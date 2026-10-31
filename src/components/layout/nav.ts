/** Phase-1 shell. The editor stays under 流程; there is no third rail item. */
export const SHELL_NAV = [
  { href: "/workflows", label: "流程" },
  { href: "/runs", label: "运行" },
] as const;

export type ShellNavHref = (typeof SHELL_NAV)[number]["href"];

/** True on the section root and its nested pages, including the workflow editor. */
export function isShellNavActive(href: ShellNavHref, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
