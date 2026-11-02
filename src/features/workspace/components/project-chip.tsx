"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, FolderOpen, LogOut } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCloseProject, useCurrentProject } from "@/features/workspace/queries";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { ProjectBadge } from "./project-badge";

/**
 * The open project in the top bar. Inside a project there is no switcher: closing it goes back to the welcome
 * page, where every project is listed.
 */
export function ProjectChip() {
  const router = useRouter();
  const { project, isPending } = useCurrentProject();
  const close = useCloseProject();

  if (isPending) return <span className="h-8 w-36 animate-pulse rounded-lg bg-accent" aria-hidden />;
  if (!project) {
    return (
      <Link href="/" className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
        <FolderOpen className="size-4" />
        打开项目
      </Link>
    );
  }
  const bridge = desktop();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 max-w-72 items-center gap-2 rounded-lg border border-glass-border bg-glass py-1 pr-2 pl-1 text-sm font-medium hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label={`当前项目 ${project.name}`}
        >
          <ProjectBadge name={project.name} className="size-6 rounded-md text-[11px]" />
          <span className="truncate">{project.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
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
