"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ChevronRight, FolderOutput, History, NotebookText, Settings, Workflow, Waypoints } from "lucide-react";

import { isActive, useRuns } from "@/features/runs/queries";
import { usePref } from "@/lib/local-pref";
import { cn } from "@/lib/utils";
import { FLOW_NAV, FLOW_SUMMARY, flowGroupOpen, isFlowRoute, isNavActive, SETTINGS_NAV, WORKBENCH_NAV, type FlowNavHref } from "./nav";

const FLOW_ICONS = {
  "/workflows": Waypoints,
  "/runs": History,
  "/outputs": FolderOutput,
  "/modules": Boxes,
} satisfies Record<FlowNavHref, typeof Workflow>;

const FLOW_GROUP_KEY = "nf-studio.sidebar.flow-open";

const itemClass = (active: boolean) =>
  cn(
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
    "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&_svg]:size-[18px] [&_svg]:shrink-0",
    active && "bg-glass-strong font-medium text-primary shadow-sm hover:bg-glass-strong hover:text-primary",
  );

/**
 * Narrow labelled sidebar: 工作台 for everyday analysis, a collapsible 流程 group for everything that exists
 * for Nextflow pipelines, 设置 at the bottom. Newcomers see two items until they open the group.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [stored, setStored] = usePref<boolean>(FLOW_GROUP_KEY);
  const onFlowPage = isFlowRoute(pathname);
  const open = flowGroupOpen(pathname, stored);
  const runs = useRuns(undefined, { idlePollMs: 15_000 });
  const running = runs.data?.filter((run) => isActive(run.status)).length ?? 0;
  const groupId = React.useId();

  return (
    <nav aria-label="主导航" className="glass flex w-48 shrink-0 flex-col gap-0.5 rounded-xl px-2.5 py-3.5">
      <Link
        href="/"
        className="mb-3 flex items-center gap-2.5 rounded-lg px-1.5 py-1 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        aria-label="Nextflow Studio · 回到欢迎页"
      >
        <span className="grid size-8 place-items-center rounded-[10px] bg-primary font-mono text-xs font-bold text-primary-foreground shadow-sm">nf</span>
        <span className="font-serif text-[15px] font-bold">Studio</span>
      </Link>

      <Link
        href={WORKBENCH_NAV.href}
        aria-current={isNavActive(WORKBENCH_NAV.href, pathname) ? "page" : undefined}
        className={itemClass(isNavActive(WORKBENCH_NAV.href, pathname))}
      >
        <NotebookText />
        {WORKBENCH_NAV.label}
      </Link>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={groupId}
        // On a pipeline page the group cannot hide the page you are on; the toggle only remembers the choice.
        onClick={() => setStored(!open)}
        className={cn(itemClass(!open && onFlowPage), "mt-1")}
      >
        <Workflow />
        流程
        {!open && running > 0 ? (
          <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[11px] font-medium text-primary" aria-label={`${running} 个运行中`}>
            {running}
          </span>
        ) : null}
        <ChevronRight className={cn("!size-3.5 transition-transform", !open || running === 0 ? "ml-auto" : "", open && "rotate-90")} aria-hidden />
      </button>
      {open ? (
        <ul id={groupId} className="grid gap-0.5">
          {FLOW_NAV.map(({ href, label }) => {
            const Icon = FLOW_ICONS[href];
            const active = isNavActive(href, pathname);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={cn(itemClass(active), "h-8 pl-5 text-[13px] [&_svg]:size-4")}>
                  <Icon />
                  {label}
                  {href === "/runs" && running > 0 ? (
                    <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[11px] font-medium text-primary" aria-label={`${running} 个运行中`}>
                      {running}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p id={groupId} className="pr-1 pl-[38px] text-[11px] leading-relaxed text-muted-foreground">{FLOW_SUMMARY}</p>
      )}

      <Link
        href={SETTINGS_NAV.href}
        aria-current={isNavActive(SETTINGS_NAV.href, pathname) ? "page" : undefined}
        className={cn(itemClass(isNavActive(SETTINGS_NAV.href, pathname)), "mt-auto")}
      >
        <Settings />
        {SETTINGS_NAV.label}
      </Link>
    </nav>
  );
}
