"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Boxes, FolderOpen, Loader2, MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelLoading } from "@/components/ui/panel-notice";
import { getProductTheme } from "@/lib/product-theme";
import { SearchField } from "@/components/ui/search-field";
import { PathBrowserDialog } from "@/features/files/components/path-input";
import { useFsListing } from "@/features/files/queries";
import { displayPath, EXAMPLE_PROJECT_ID, filterProjects, openedLabel } from "@/features/workspace/projects";
import { useCreateProject, useForgetProject, useOpenProject, useProjects, useReopenProject } from "@/features/workspace/queries";
import type { CreateProjectRequest, Project } from "@/features/workspace/types";
import { toast } from "@/lib/toast";
import { desktop } from "@/lib/desktop";
import { useIsDesktop } from "@/lib/use-desktop";
import { cn } from "@/lib/utils";
import { BackendCard } from "./backend-card";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectBadge } from "./project-badge";

const productTheme = getProductTheme();

export interface WelcomeViewProps {
  projects: Project[];
  home?: string;
  busyId?: string;
  /** The 后端环境 card (BackendCard); stories pass a BackendCardView. */
  backend?: React.ReactNode;
  /** Keyboard hints of the desktop app's File menu; none in a browser. */
  shortcuts?: { newProject: string; openDirectory: string };
  onNew: () => void;
  onOpenDirectory: () => void;
  onOpen: (project: Project) => void;
  onForget: (project: Project) => void;
}

interface ActionRowProps extends React.ComponentProps<"button"> {
  icon: React.ReactNode;
  shortcut?: string;
  primary?: boolean;
}

/** One start action: the same height, icon tile and type for each, the first one tinted. */
function ActionRow({ icon, shortcut, primary, children, className, ...props }: ActionRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex h-10 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
        primary ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-glass-strong",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
          primary ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground",
        )}
      >
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      {shortcut ? <kbd className="font-mono text-[11px] font-normal text-muted-foreground">{shortcut}</kbd> : null}
    </button>
  );
}

/** Presentational welcome page: start actions and the backend on the left, recent projects on the right. */
export function WelcomeView({ projects, home, busyId, backend, shortcuts, onNew, onOpenDirectory, onOpen, onForget }: WelcomeViewProps) {
  const [query, setQuery] = React.useState("");
  const visible = filterProjects(projects, query);
  // A shortcut to the preset example project while it is on the list. It is otherwise an ordinary project.
  const example = projects.find((project) => project.id === EXAMPLE_PROJECT_ID);

  return (
    <div className="flex h-full gap-3 p-3">
      <aside className="flex w-80 shrink-0 flex-col px-5 pt-9 pb-5">
        <div className="flex items-center gap-3 px-2">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary font-mono text-base font-bold text-primary-foreground">{productTheme.shortName}</span>
          <div className="min-w-0">
            <h1 className="font-serif text-xl leading-tight font-bold">{productTheme.displayName}</h1>
            <p className="text-xs text-muted-foreground">{productTheme.tagline}</p>
          </div>
        </div>

        <nav aria-label="开始" className="mt-9 grid gap-1">
          <ActionRow primary icon={<Plus />} shortcut={shortcuts?.newProject} onClick={onNew}>新建项目</ActionRow>
          <ActionRow icon={<FolderOpen />} shortcut={shortcuts?.openDirectory} onClick={onOpenDirectory}>打开目录</ActionRow>
          {example ? (
            <ActionRow icon={busyId === example.id ? <Loader2 className="animate-spin" /> : <BookOpen />} onClick={() => onOpen(example)} disabled={busyId === example.id}>
              从示例开始
            </ActionRow>
          ) : null}
        </nav>

        <div className="mt-auto grid gap-3 pt-6">
          {backend}
          <nav aria-label="其他" className="flex gap-1">
            <Link href="/modules" className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-glass-strong hover:text-foreground [&_svg]:size-4">
              <Boxes aria-hidden />
              模块库
            </Link>
            <Link href="/settings" className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-glass-strong hover:text-foreground [&_svg]:size-4">
              <Settings aria-hidden />
              设置
            </Link>
          </nav>
        </div>
      </aside>

      <main className="glass flex min-w-0 flex-1 flex-col gap-4 rounded-2xl px-8 py-9">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-xl font-bold">最近的项目</h2>
          {projects.length ? (
            <div className="ml-auto w-64">
              <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />
            </div>
          ) : null}
        </div>
        {projects.length === 0 ? (
          <div className="grid flex-1 place-items-center">
            <div className="grid justify-items-center gap-4 text-center">
              <div className="grid gap-1">
                <p className="font-medium">还没有项目</p>
                <p className="text-sm text-muted-foreground">新建一个项目，或把已有的文件夹作为项目打开。</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={onNew}><Plus />新建项目</Button>
                <Button type="button" variant="glass" onClick={onOpenDirectory}><FolderOpen />打开目录</Button>
              </div>
            </div>
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
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{project.name}</span>
                      {project.id === EXAMPLE_PROJECT_ID ? <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">示例</span> : null}
                    </span>
                    <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={project.path}>{displayPath(project.path, home)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {busyId === project.id ? <Loader2 className="size-4 animate-spin" aria-label="正在打开" /> : openedLabel(project.openedAt)}
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
  const isDesktop = useIsDesktop();
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


  if (projects.isPending) return <PanelLoading />;
  const mac = isDesktop && desktop()?.platform === "darwin";
  return (
    <>
      <WelcomeView
        projects={projects.data?.projects ?? []}
        home={home}
        backend={<BackendCard />}
        shortcuts={isDesktop ? { newProject: mac ? "⇧⌘N" : "Ctrl+Shift+N", openDirectory: mac ? "⌘O" : "Ctrl+O" } : undefined}
        busyId={reopen.isPending ? reopen.variables : undefined}
        onNew={() => { create.reset(); setCreating(true); }}
        onOpenDirectory={() => setBrowsing(true)}
        onOpen={(project) => reopen.mutate(project.id, { onSuccess: enter, onError: fail })}
        onForget={(project) => forget.mutate(project.id, {
          onSuccess: () => toast.info(`已从列表移除「${project.name}」，文件夹还在 ${project.path}`),
          onError: fail,
        })}
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
