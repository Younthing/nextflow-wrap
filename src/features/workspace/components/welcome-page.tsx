"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, FolderOpen, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelLoading } from "@/components/ui/panel-notice";
import { SearchField } from "@/components/ui/search-field";
import { PathBrowserDialog } from "@/features/files/components/path-input";
import { useFsListing } from "@/features/files/queries";
import { useHealthStatus } from "@/features/runs/queries";
import { displayPath, filterProjects, openedLabel } from "@/features/workspace/projects";
import { useCreateProject, useForgetProject, useOpenProject, useProjects, useReopenProject } from "@/features/workspace/queries";
import type { CreateProjectRequest, Project } from "@/features/workspace/types";
import { desktop } from "@/lib/desktop";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectBadge } from "./project-badge";

export interface WelcomeViewProps {
  projects: Project[];
  home?: string;
  environment?: string;
  busyId?: string;
  onNew: () => void;
  onOpenDirectory: () => void;
  onOpen: (project: Project) => void;
  onForget: (project: Project) => void;
  /** Desktop only: a folder dragged in from the file manager. */
  onDropPath?: (path: string) => void;
}

/** Presentational welcome page: actions on the left, recent projects on the right. */
export function WelcomeView({ projects, home, environment, busyId, onNew, onOpenDirectory, onOpen, onForget, onDropPath }: WelcomeViewProps) {
  const [query, setQuery] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const visible = filterProjects(projects, query);
  const example = projects.find((project) => project.example);
  const actionClass = "flex w-full items-center gap-3 rounded-xl border border-glass-border bg-glass px-3.5 py-3 text-left text-sm transition-colors hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60 [&_svg]:size-[18px] [&_svg]:shrink-0";

  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="flex w-80 shrink-0 flex-col gap-7 px-7 py-10">
        <div className="grid gap-4">
          <span className="grid size-13 place-items-center rounded-2xl bg-primary font-mono text-lg font-bold text-primary-foreground shadow-action shadow-primary/60">nf</span>
          <div>
            <h1 className="font-serif text-2xl font-bold">Nextflow Studio</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{environment ?? "正在检查运行环境…"}</p>
          </div>
        </div>
        <div className="grid gap-2">
          <button type="button" onClick={onNew} className={cn(actionClass, "border-transparent bg-primary text-primary-foreground shadow-action shadow-primary/50 hover:bg-primary/90")}>
            <Plus />
            新建项目
          </button>
          <button type="button" onClick={onOpenDirectory} className={actionClass}>
            <FolderOpen />
            打开目录
          </button>
          {example ? (
            <button type="button" onClick={() => onOpen(example)} className={actionClass} disabled={busyId === example.id}>
              <BookOpen />
              从示例开始
            </button>
          ) : null}
        </div>
        <nav aria-label="其他" className="mt-auto flex gap-4 text-sm text-muted-foreground">
          <Link href="/modules" className="hover:text-foreground">模块库</Link>
          <Link href="/settings" className="hover:text-foreground">设置</Link>
        </nav>
      </aside>

      <main
        className={cn("glass flex min-w-0 flex-1 flex-col gap-4 rounded-2xl px-8 py-9", dragging && "ring-2 ring-primary/60")}
        onDragOver={(event) => {
          if (!onDropPath || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (!onDropPath || !file) return;
          event.preventDefault();
          const path = desktop()?.pathForFile(file);
          if (path) onDropPath(path);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-xl font-bold">最近的项目</h2>
          <div className="ml-auto w-64">
            <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />
          </div>
        </div>
        {projects.length === 0 ? (
          <div className="grid flex-1 place-items-center text-center">
            <p className="text-sm text-muted-foreground">还没有项目</p>
          </div>
        ) : (
          <ul aria-label="最近的项目" className="-mx-2 grid min-h-0 gap-0.5 overflow-y-auto">
            {visible.map((project) => (
              <li key={project.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(project)}
                  disabled={busyId === project.id}
                  className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl px-3 py-2.5 pr-12 text-left transition-colors hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <ProjectBadge name={project.name} className="size-10 rounded-xl text-[15px]" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex items-center gap-2 truncate font-medium">
                      {project.name}
                      {project.example ? <Badge variant="secondary">示例</Badge> : null}
                    </span>
                    <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={project.path}>{displayPath(project.path, home)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {busyId === project.id ? <Loader2 className="size-4 animate-spin" aria-label="正在打开" /> : project.example && project.openedAt.startsWith("1970") ? "未打开过" : openedLabel(project.openedAt)}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`更多操作：${project.name}`}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {desktop() ? (
                      <DropdownMenuItem onSelect={() => void desktop()?.showItemInFolder(project.path)}>
                        <FolderOpen />
                        在文件管理器中显示
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => onForget(project)}>
                      <Trash2 />
                      从列表移除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
            {visible.length === 0 ? <li className="px-3 py-6 text-sm text-muted-foreground">没有匹配「{query}」的项目</li> : null}
          </ul>
        )}
      </main>
    </div>
  );
}

/** `/`: pick, create or open a project. Opening one goes to the workbench. */
export function WelcomePage() {
  const router = useRouter();
  const projects = useProjects();
  const health = useHealthStatus();
  const homeListing = useFsListing(undefined, true);
  const create = useCreateProject();
  const openPath = useOpenProject();
  const reopen = useReopenProject();
  const forget = useForgetProject();
  const [creating, setCreating] = React.useState(false);
  const [browsing, setBrowsing] = React.useState(false);
  const home = homeListing.data?.home;
  const enter = () => router.push("/workbench");
  const fail = (error: Error) => toast.error(error.message);

  const openDirectory = async () => {
    const bridge = desktop();
    if (!bridge) { setBrowsing(true); return; }
    const [picked] = await bridge.pickPath({ kind: "directory", title: "打开目录作为项目" });
    if (picked) openPath.mutate(picked, { onSuccess: enter, onError: fail });
  };

  if (projects.isPending) return <PanelLoading />;
  const environment = health.data
    ? `Nextflow ${health.data.nextflowVersion}${health.data.status === "ok" ? " · 运行环境正常" : " · 运行环境待检查"}`
    : undefined;
  return (
    <>
      <WelcomeView
        projects={projects.data?.projects ?? []}
        home={home}
        environment={environment}
        busyId={reopen.isPending ? reopen.variables : undefined}
        onNew={() => { create.reset(); setCreating(true); }}
        onOpenDirectory={() => void openDirectory()}
        onOpen={(project) => reopen.mutate(project.id, { onSuccess: enter, onError: fail })}
        onForget={(project) => forget.mutate(project.id, {
          onSuccess: () => toast.info(`已从列表移除「${project.name}」，文件夹还在 ${project.path}`),
          onError: fail,
        })}
        onDropPath={desktop() ? (path) => openPath.mutate(path, { onSuccess: enter, onError: fail }) : undefined}
      />
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        defaultParent={home ?? ""}
        pending={create.isPending}
        error={create.error?.message}
        onCreate={(request: CreateProjectRequest) => create.mutate(request, { onSuccess: enter })}
      />
      {browsing ? (
        <PathBrowserDialog
          open={browsing}
          onOpenChange={setBrowsing}
          options={{ kind: "directory", title: "打开目录作为项目", defaultPath: home }}
          onPick={(path) => openPath.mutate(path, { onSuccess: enter, onError: fail })}
        />
      ) : null}
    </>
  );
}
