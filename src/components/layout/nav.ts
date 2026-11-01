/** Shell rail: 流程, 笔记本, 运行. Module catalog stays under 流程. */
export const SHELL_NAV = [
  { href: "/workflows", label: "流程" },
  { href: "/notebooks", label: "笔记本" },
  { href: "/runs", label: "运行" },
] as const;

export type ShellNavHref = (typeof SHELL_NAV)[number]["href"];

/** True on the section root and its nested pages, including the workflow editor. */
export function isShellNavActive(href: ShellNavHref, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
