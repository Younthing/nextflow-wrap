"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, NotebookText, Workflow } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isShellNavActive, SHELL_NAV, type ShellNavHref } from "./nav";

const ICONS = {
  "/workflows": Workflow,
  "/notebooks": NotebookText,
  "/runs": History,
} satisfies Record<ShellNavHref, typeof Workflow>;

export function NavRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="glass flex w-14 shrink-0 flex-col items-center gap-2 rounded-xl py-3"
    >
      <Link
        href="/workflows"
        className="mb-2 grid size-9 place-items-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground"
        aria-label="nf · Nextflow Studio"
      >
        nf
      </Link>
      {SHELL_NAV.map(({ href, label }) => {
        const Icon = ICONS[href];
        const active = isShellNavActive(href, pathname);
        return (
          <Tooltip key={href}>
            <TooltipTrigger asChild>
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-glass-strong text-primary shadow-sm",
                )}
              >
                <Icon className="size-[18px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
