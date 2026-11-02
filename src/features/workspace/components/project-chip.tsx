"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, FolderOpen, LogOut } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCloseProject, useCurrentProject } from "@/features/workspace/queries";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ProjectBadge } from "./project-badge";

/**
 * The open project at the top of the sidebar, for the browser build; the desktop app puts it in the File menu.
 * Inside a project there is no switcher: closing it goes back to the welcome page, where every project is listed.
 * Collapsed, only the project's badge shows.
 */
export function ProjectChip({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { project, isPending } = useCurrentProject();
  const close = useCloseProject();

  if (isPending) return <span className="h-8 w-full animate-pulse rounded-lg bg-accent" aria-hidden />;
  if (!project) {
    return (
      <Link
        href="/"
        title={collapsed ? "打开项目" : undefined}
        className={cn("flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", collapsed && "justify-center px-0")}
      >
        <FolderOpen className="size-4 shrink-0" />
        {collapsed ? <span className="sr-only">打开项目</span> : "打开项目"}
      </Link>
    );
  }
  const bridge = desktop();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? project.name : undefined}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-lg border border-glass-border bg-glass py-1 pr-2 pl-1 text-sm font-medium hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            collapsed && "justify-center border-transparent bg-transparent p-0",
          )}
        >
          <ProjectBadge name={project.name} className="size-6 shrink-0 rounded-md text-[11px]" />
          <span className={cn("min-w-0 flex-1 truncate text-left", collapsed && "sr-only")}><span className="sr-only">当前项目：</span>{project.name}</span>
          {collapsed ? null : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-72">
        <DropdownMenuLabel className="font-normal tracking-normal">
          <span className="block text-sm font-medium text-foreground">{project.name}</span>
          <span className="block truncate font-mono text-[11px]" title={project.path}>{project.path}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {bridge ? (
          <DropdownMenuItem onSelect={() => void bridge.showItemInFolder(project.path)}>
            <FolderOpen />
            在文件管理器中显示
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => close.mutate(undefined, {
            onSuccess: () => router.push("/"),
            onError: (error) => toast.error(error.message),
          })}
        >
          <LogOut />
          关闭项目，回到欢迎页
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
