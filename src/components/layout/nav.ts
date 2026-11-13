/**
 * Sidebar: 工作台 on top, then the collapsible 流程 group (everything that exists for Nextflow pipelines),
 * 设置 at the bottom. Routes stay flat; the group is only how the sidebar shows them.
 */
export const WORKBENCH_NAV = { href: "/workbench", label: "工作台" } as const;

export const FLOW_NAV = [
  { href: "/workflows", label: "流程编排" },
  { href: "/runs", label: "运行记录" },
  { href: "/outputs", label: "产物" },
  { href: "/modules", label: "模块库" },
] as const;

export const SETTINGS_NAV = { href: "/settings", label: "设置" } as const;

/** One line under the collapsed 流程 group, so newcomers know what is inside. */
export const FLOW_SUMMARY = "编排、运行记录、产物、模块库";

export type FlowNavHref = (typeof FLOW_NAV)[number]["href"];
export type NavHref = FlowNavHref | typeof WORKBENCH_NAV.href | typeof SETTINGS_NAV.href;

const within = (href: string, pathname: string) => pathname === href || pathname.startsWith(`${href}/`);

/** True on the section root and its nested pages, including the workflow editor. 设置 also covers the setup page. */
export function isNavActive(href: NavHref, pathname: string): boolean {
  if (href === SETTINGS_NAV.href) return within("/settings", pathname) || within("/setup", pathname);
  return within(href, pathname);
}

export const isFlowRoute = (pathname: string) => FLOW_NAV.some((item) => isNavActive(item.href, pathname));

/** Pages drawn without the sidebar: the welcome page and the first-run setup. */
export const isBareRoute = (pathname: string) => pathname === "/" || within("/setup", pathname);

/** Use the saved choice, or open the group on pipeline pages on the first visit. */
export const flowGroupOpen = (pathname: string, stored: boolean | null) => stored ?? isFlowRoute(pathname);
