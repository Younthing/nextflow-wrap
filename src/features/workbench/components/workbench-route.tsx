"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Button } from "@/components/ui/button";
import { PANELS, useLayoutStore, usePanel } from "@/components/layout/layout-store";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { PanelLoading } from "@/components/ui/panel-notice";
import { NotebookEditor } from "@/features/notebook/components/notebook-editor";
import { PublishWizard } from "@/features/notebook/components/publish-wizard";
import { useCreateNotebook, useNotebooks } from "@/features/notebook/queries";
import type { NotebookSummary } from "@/features/notebook/types";
import { closeTab, openTab, pruneTabs, tabsPrefKey, workbenchView } from "@/features/workbench/tabs";
import { useCurrentProject } from "@/features/workspace/queries";
import type { Project } from "@/features/workspace/types";
import { usePref } from "@/lib/local-pref";
import { shownWidth } from "@/lib/panel-size";
import { toast } from "@/lib/toast";
import { WorkbenchFiles } from "./workbench-files";
import { WorkbenchRuntimes } from "./workbench-runtimes";
import { WorkbenchStart } from "./workbench-start";
import { WorkbenchTabs } from "./workbench-tabs";

export function WorkbenchRoute({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = React.use(params);
  return <Workbench path={path} />;
}

/** Shown when the workbench is opened with no project, for example from an old bookmark. */
export function NoProject() {
  return (
    <div className="glass grid size-full place-items-center rounded-xl p-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-3">
        <FolderOpen className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="font-serif text-lg font-semibold">还没有打开项目</h1>
        <Button asChild><Link href="/">去欢迎页</Link></Button>
      </div>
    </div>
  );
}

export function Workbench({ path }: { path?: string[] }) {
  const { project, isPending, error } = useCurrentProject();
  if (isPending) return <PanelLoading />;
  if (error) return <AsyncPlaceholder status="error" message={error.message} />;
  if (!project) return <NoProject />;
  return <WorkbenchFrame key={project.id} project={project} path={path} />;
}

function WorkbenchFrame({ project, path }: { project: Project; path?: string[] }) {
  const router = useRouter();
  const view = workbenchView(path);
  const activeId = view.kind === "notebook" || view.kind === "publish" ? view.id : undefined;
  const notebooks = useNotebooks(project.id);
  const create = useCreateNotebook();
  const [stored, setStored] = usePref<string[]>(tabsPrefKey(project.id));
  const list = notebooks.data ?? [];

  // The route decides the active tab; opening a notebook by link adds it.
  let tabs = stored ?? [];
  if (notebooks.data) tabs = pruneTabs(tabs, [...list.map((nb) => nb.id), ...(activeId ? [activeId] : [])]);
  if (activeId) tabs = openTab(tabs, activeId);
  const tabsKey = tabs.join("|");
  React.useEffect(() => {
    if (stored !== null && tabsKey === stored.join("|")) return;
    setStored(tabsKey ? tabsKey.split("|") : []);
  }, [tabsKey, stored, setStored]);

  const names = Object.fromEntries(list.map((nb) => [nb.id, nb.name]));
  const active: NotebookSummary | undefined = list.find((nb) => nb.id === activeId);

  const createNotebook = (kernel = "py311-pandas") => {
    create.mutate(
      { name: "未命名笔记本", description: "", kernel, cells: [{ id: "c1", role: "code", source: "" }], projectId: project.id },
      { onSuccess: (doc) => router.push(`/workbench/${doc.id}`), onError: (err) => toast.error(err.message) },
    );
  };

  const explorer = usePanel("explorer");
  const togglePanel = useLayoutStore((state) => state.togglePanel);
  // Ctrl/Cmd+B shows or hides the explorer, as in VS Code.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      event.preventDefault();
      togglePanel("explorer");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const close = (id: string) => {
    const result = closeTab(tabs, id, activeId);
    setStored(result.tabs);
    if (activeId === id) router.push(result.next ? `/workbench/${result.next}` : "/workbench");
  };

  return (
    <div className="flex size-full min-h-0">
      <div
        className="panel-animate flex min-h-0 shrink-0 overflow-hidden"
        style={{ width: shownWidth(PANELS.explorer, explorer) }}
        inert={explorer.collapsed}
      >
        <aside aria-label="笔记本、文件与运行时" className="glass flex min-h-0 w-full min-w-[200px] flex-col gap-2 rounded-xl px-1.5 pt-3 pb-2">
          <WorkbenchFiles
            project={project}
            notebooks={list}
            loading={notebooks.isPending}
            activeId={activeId}
            creating={create.isPending}
            onCreate={() => createNotebook()}
          />
          <WorkbenchRuntimes notebooks={list} active={active} />
        </aside>
      </div>
      <ResizeHandle panel="explorer" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {view.kind === "publish" ? (
          <PublishWizard notebookId={view.id} />
        ) : (
          <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
            <WorkbenchTabs tabs={tabs} names={names} active={activeId} onClose={close} />
            {view.kind === "notebook" ? (
              <NotebookEditor key={view.id} notebookId={view.id} />
            ) : view.kind === "missing" ? (
              <AsyncPlaceholder status="error" className="m-4 h-auto" message="没有这个页面" />
            ) : (
              <WorkbenchStart
                project={project}
                notebooks={list}
                creating={create.isPending ? create.variables?.kernel : undefined}
                onCreate={createNotebook}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
