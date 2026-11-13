"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ChevronRight, FolderOutput, History, NotebookText, Settings, Workflow, Waypoints } from "lucide-react";

import { AssistantButton } from "@/features/assistant/assistant-button";
import { isActive, useRuns } from "@/features/runs/queries";
import { ProjectChip } from "@/features/workspace/components/project-chip";
import { usePref } from "@/lib/local-pref";
import { getProductTheme } from "@/lib/product-theme";
import { ProductMark } from "@/lib/product-theme/mark";
import { useIsDesktop } from "@/lib/use-desktop";
import { cn } from "@/lib/utils";
import { BackendStatus } from "./backend-status";
import { useLayoutStore } from "./layout-store";
import { FLOW_NAV, FLOW_SUMMARY, flowGroupOpen, isFlowRoute, isNavActive, SETTINGS_NAV, WORKBENCH_NAV, type FlowNavHref } from "./nav";
import { sidebarItemClass as itemClass } from "./sidebar-item";
import { ThemeToggle } from "./theme-toggle";

const productTheme = getProductTheme();

const FLOW_ICONS = {
  "/workflows": Waypoints,
  "/runs": History,
  "/outputs": FolderOutput,
  "/modules": Boxes,
} satisfies Record<FlowNavHref, typeof Workflow>;

const FLOW_GROUP_KEY = "nf-studio.sidebar.flow-open";

function RunningBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-primary/15 px-1.5 text-[11px] font-medium text-primary",
        collapsed ? "absolute -top-0.5 right-0.5 bg-primary px-1 text-[10px] leading-4 text-primary-foreground" : "ml-auto",
      )}
      aria-label={`${count} 个运行中`}
    >
      {count}
    </span>
  );
}

/**
 * Labelled sidebar: 工作台 for everyday analysis, a collapsible 流程 group for everything that exists for
 * Nextflow pipelines, and at the bottom the backend status, AI assistant, theme and 设置. Newcomers see two items
 * until they open the group. Collapsed, it is an icon rail with every page one click away.
 */
export function Sidebar({ collapsed = false, openDocumentsRef }: { collapsed?: boolean; openDocumentsRef?: React.Ref<HTMLDivElement> }) {
  const pathname = usePathname();
  const [stored, setStored] = usePref<boolean>(FLOW_GROUP_KEY);
  const onFlowPage = isFlowRoute(pathname);
  const open = flowGroupOpen(pathname, stored);
  const runs = useRuns(undefined, { idlePollMs: 15_000 });
  const running = runs.data?.filter((run) => isActive(run.status)).length ?? 0;
  const groupId = React.useId();
  const desktop = useIsDesktop();
  const toggle = useLayoutStore((state) => state.togglePanel);
  const onWorkbench = isNavActive(WORKBENCH_NAV.href, pathname);

  const flowLinks = (
    <ul id={groupId} className="grid gap-0.5">
      {FLOW_NAV.map(({ href, label }) => {
        const Icon = FLOW_ICONS[href];
        const active = isNavActive(href, pathname);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? label : undefined}
              title={collapsed ? label : undefined}
              className={cn(itemClass(active, collapsed), !collapsed && "h-8 pl-5 text-[13px] [&_svg]:size-4")}
            >
              <Icon />
              {collapsed ? null : label}
              {href === "/runs" ? <RunningBadge count={running} collapsed={collapsed} /> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label="主导航" className={cn("glass flex size-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-xl py-3.5", collapsed ? "px-2" : "px-2.5")}>
      <div className={cn("mb-3 flex items-center gap-1", collapsed && "flex-col")}>
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          title="回到欢迎页"
        >
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary font-mono text-xs font-bold text-primary-foreground shadow-sm"><ProductMark theme={productTheme} className="size-6" /></span>
          <span className={cn("font-serif text-[15px] font-bold", collapsed && "sr-only")}>{productTheme.displayName}<span className="sr-only">，回到欢迎页</span></span>
        </Link>
      </div>

      {/* The desktop app shows the project in its File menu. */}
      {desktop ? null : <div className="mb-2"><ProjectChip collapsed={collapsed} /></div>}

      <Link
        href={WORKBENCH_NAV.href}
        aria-current={onWorkbench ? "page" : undefined}
        aria-expanded={onWorkbench ? !collapsed : undefined}
        aria-label={collapsed ? WORKBENCH_NAV.label : undefined}
        title={onWorkbench ? (collapsed ? "展开工作台侧栏" : "收起工作台侧栏") : WORKBENCH_NAV.label}
        className={itemClass(onWorkbench, collapsed)}
        onNavigate={(event) => {
          if (onWorkbench) event.preventDefault();
          if (onWorkbench || collapsed) toggle("nav");
        }}
      >
        <NotebookText />
        {collapsed ? null : WORKBENCH_NAV.label}
      </Link>
      <div ref={openDocumentsRef} hidden={collapsed} className="min-h-0 overflow-y-auto" />

      {collapsed ? (
        <>
          <span aria-hidden className="mx-2 my-1.5 h-px bg-border" />
          {flowLinks}
        </>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={groupId}
            onClick={() => setStored(!open)}
            className={cn(itemClass(!open && onFlowPage), "mt-1")}
          >
            <Workflow />
            流程
            {!open ? <RunningBadge count={running} collapsed={false} /> : null}
            <ChevronRight className={cn("!size-3.5 transition-transform", !open || running === 0 ? "ml-auto" : "", open && "rotate-90")} aria-hidden />
          </button>
          {open ? flowLinks : (
            <p id={groupId} className="pr-1 pl-[38px] text-[11px] leading-relaxed text-muted-foreground">{FLOW_SUMMARY}</p>
          )}
        </>
      )}

      <div className="mt-auto grid gap-0.5 pt-3">
        <div className={cn("pb-1.5", !collapsed && "px-1.5")}>
          <BackendStatus collapsed={collapsed} />
        </div>
        <AssistantButton collapsed={collapsed} />
        <ThemeToggle collapsed={collapsed} />
        <Link
          href={SETTINGS_NAV.href}
          aria-current={isNavActive(SETTINGS_NAV.href, pathname) ? "page" : undefined}
          aria-label={collapsed ? SETTINGS_NAV.label : undefined}
          title={collapsed ? SETTINGS_NAV.label : undefined}
          className={itemClass(isNavActive(SETTINGS_NAV.href, pathname), collapsed)}
        >
          <Settings />
          {collapsed ? null : SETTINGS_NAV.label}
        </Link>
      </div>
    </nav>
  );
}
