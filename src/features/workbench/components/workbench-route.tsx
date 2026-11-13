"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FolderOpen, PanelLeft } from "lucide-react";

import { AsyncPlaceholder } from "@/components/ui/async-placeholder";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PANELS, useLayoutStore, usePanel } from "@/components/layout/layout-store";
import { OpenDocumentsSlot } from "@/components/layout/app-shell";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { PanelLoading } from "@/components/ui/panel-notice";
import { NotebookAssistant } from "@/features/assistant/surfaces/notebook";
import { NotebookEditor } from "@/features/notebook/components/notebook-editor";
import { NotebookSessionProvider } from "@/features/notebook/session-provider";
import { PublishWizard } from "@/features/notebook/components/publish-wizard";
import { useCreateNotebook, useNotebooks } from "@/features/notebook/queries";
import type { NotebookSummary } from "@/features/notebook/types";
import { WorkflowEditor } from "@/features/editor/components/workflow-editor";
import { EditorProvider } from "@/features/editor/editor-provider";
import { dirtyDocument, forgetDocument, moveTextDocuments, pauseDocument, saveDocument, workflowSession } from "../document-sessions";
import { useProjectChanges } from "@/features/workspace/use-project-changes";
import { emptyWorkflow } from "@/features/workflow/document";
import { useSaveWorkflow, useWorkflows } from "@/features/workflow/queries";
import { NotebookConflict } from "./document-conflict";
import { ReferenceUpdateDialog } from "@/features/workspace/components/reference-update-dialog";
import { TextEditor } from "./text-editor";
import { closeTab, openTab, workbenchPathFromPathname, workbenchView } from "@/features/workbench/tabs";
import { useCurrentProject } from "@/features/workspace/queries";
import type { Project } from "@/features/workspace/types";
import type { FileMove } from "@/features/workspace/reference-updates";
import { useWindowTabs } from "../window-tabs";
import { shownWidth } from "@/lib/panel-size";
import { toast } from "@/lib/toast";
import { useCompactLayout } from "@/lib/use-compact-layout";
import { cn } from "@/lib/utils";
import { WorkbenchFiles } from "./workbench-files";
import { WorkbenchRuntimes } from "./workbench-runtimes";
import { defaultKernel } from "@/features/notebook/kernel-choices";
import { mockingActive } from "@/lib/mocking";
import { WorkbenchStart } from "./workbench-start";
import { OpenDocuments } from "./open-documents";

export function WorkbenchRoute() {
  // Follow the live URL so soft navigations inside `/workbench/[[...path]]` update the editor
  // even when Cache Components reuses an App Shell without fresh RSC params.
  const path = workbenchPathFromPathname(usePathname());
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
  const openDocumentsSlot = React.useContext(OpenDocumentsSlot);
  useProjectChanges(project.id);
  const view = workbenchView(path);
  const activeId = view.kind === "notebook" || view.kind === "publish" ? view.id : view.kind === "workflow" ? `workflow/${view.id}` : view.kind === "file" ? `file/${encodeURIComponent(view.id)}` : undefined;
  const workflows = useWorkflows();
  const notebooks = useNotebooks(project.id);
  const create = useCreateNotebook();
  const createWorkflow = useSaveWorkflow();
  const [stored, setStored, tabsReady] = useWindowTabs(project.id);
  const list = notebooks.data ?? [];
  const [closing, setClosing] = React.useState<string>();
  const [closeError, setCloseError] = React.useState<string>();
  const [departing, setDeparting] = React.useState<string>();

  // The route decides the active tab; opening a notebook by link adds it.
  let tabs = stored ?? [];
  // The old route can render again before the replacement route commits.
  if (departing && departing !== activeId) setDeparting(undefined);
  if (activeId && activeId !== departing) tabs = openTab(tabs, activeId);
  const tabsKey = tabs.join("|");
  React.useEffect(() => {
    if (!tabsReady || tabsKey === stored.join("|")) return;
    setStored(tabsKey ? tabsKey.split("|") : []);
  }, [tabsKey, stored, setStored, tabsReady]);

  React.useEffect(() => {
    const listener = (event: Event) => {
      const moves = (event as CustomEvent<FileMove[]>).detail;
      moveTextDocuments(moves);
      const mapped = (tab: string) => {
        if (!tab.startsWith("file/")) return tab;
        const path = decodeURIComponent(tab.slice(5));
        const move = moves.find(({ from }) => path === from || path.startsWith(`${from}/`));
        return move ? `file/${encodeURIComponent(`${move.to}${path.slice(move.from.length)}`)}` : tab;
      };
      setStored(stored.map(mapped));
      if (activeId && mapped(activeId) !== activeId) router.replace(`/workbench/${mapped(activeId)}`);
    };
    window.addEventListener("studio-files-moved", listener);
    return () => window.removeEventListener("studio-files-moved", listener);
  }, [stored, activeId, setStored, router]);

  const names = Object.fromEntries([...list.map((nb) => [nb.id, nb.name]), ...(workflows.data ?? []).map((doc) => [`workflow/${doc.id}`, doc.name])]);
  const active: NotebookSummary | undefined = list.find((nb) => nb.id === activeId);

  const createNotebook = (kernel = defaultKernel("python", mockingActive()), folder?: string) => {
    create.mutate(
      { folder, name: "未命名笔记本", description: "", kernel, cells: [{ id: "c1", role: "code", source: "" }], projectId: project.id },
      { onSuccess: (doc) => router.push(`/workbench/${doc.id}`), onError: (err) => toast.error(err.message) },
    );
  };

  const explorer = usePanel("explorer");
  const togglePanel = useLayoutStore((state) => state.togglePanel);
  const { ref: frameRef, compact } = useCompactLayout(1280);
  const [compactExplorerOpen, setCompactExplorerOpen] = React.useState(false);
  const compactWorkflow = view.kind === "workflow" && compact;
  const explorerHidden = compactWorkflow ? !compactExplorerOpen : explorer.collapsed;
  const toggleExplorer = React.useCallback(() => {
    if (compactWorkflow) setCompactExplorerOpen((open) => !open);
    else togglePanel("explorer");
  }, [compactWorkflow, togglePanel]);
  // Ctrl/Cmd+B shows or hides the explorer, as in VS Code.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      event.preventDefault();
      toggleExplorer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleExplorer]);

  const closeNow = (id: string) => {
    forgetDocument(id);
    setClosing(undefined);
    setCloseError(undefined);
    const result = closeTab(tabs, id, activeId);
    if (activeId === id) {
      setDeparting(id);
      router.push(result.next ? `/workbench/${result.next}` : "/workbench");
    }
    setStored(result.tabs);
  };
  const explorerButton = (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="项目文件" title="项目文件" aria-expanded={!explorerHidden} aria-controls="workbench-explorer" onClick={toggleExplorer}>
      <PanelLeft />
    </Button>
  );

  return (
    <div ref={frameRef} className="relative flex size-full min-h-0">
      {openDocumentsSlot && createPortal(
        <OpenDocuments tabs={tabs} names={names} active={activeId} onClose={(id) => { if (dirtyDocument(id)) { pauseDocument(id, true); setClosing(id); } else closeNow(id); }} />,
        openDocumentsSlot,
      )}
      <ReferenceUpdateDialog />
      <Dialog open={!!closing} onOpenChange={(open) => { if (!open) { if (closing) pauseDocument(closing, false); setClosing(undefined); } }}>
        <DialogContent><DialogHeader><DialogTitle>保存对文件的修改？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">关闭前保存修改，或放弃本地修改。</p>
          {closeError ? <p role="alert" className="text-sm text-destructive">{closeError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { if (closing) pauseDocument(closing, false); setClosing(undefined); }}>取消</Button>
            <Button variant="outline" onClick={() => closing && closeNow(closing)}>放弃修改</Button>
            <Button onClick={async () => { if (!closing) return; try { await saveDocument(closing); closeNow(closing); } catch (error) { setCloseError(error instanceof Error ? error.message : "保存失败"); } }}>保存并关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div
        id="workbench-explorer"
        className={cn("panel-animate flex min-h-0 shrink-0 overflow-hidden", compactWorkflow && "max-w-[40%]")}
        style={{ width: compactWorkflow ? (explorerHidden ? 0 : explorer.width) : shownWidth(PANELS.explorer, explorer) }}
        inert={explorerHidden}
      >
        <aside aria-label="笔记本、文件与运行时" className="glass flex min-h-0 w-full min-w-[200px] flex-col gap-2 rounded-xl px-1.5 pt-3 pb-2">
          <WorkbenchFiles
            project={project}
            notebooks={list}
            loading={notebooks.isPending}
            activeId={activeId}
            creating={create.isPending}
            onCreate={(folder) => createNotebook(undefined, folder)}
            onCreateWorkflow={(folder) => createWorkflow.mutate({ ...emptyWorkflow(""), projectId: project.id, folder } as ReturnType<typeof emptyWorkflow>, { onSuccess: (doc) => router.push(`/workbench/workflow/${doc.id}`), onError: (error) => toast.error(error.message) })}
          />
          <WorkbenchRuntimes notebooks={list} active={active} />
        </aside>
      </div>
      <ResizeHandle panel="explorer" collapsed={compactWorkflow ? explorerHidden : undefined} onCollapsedChange={compactWorkflow ? (hidden) => setCompactExplorerOpen(!hidden) : undefined} showExpandButton={view.kind === "publish"} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {view.kind === "publish" ? (
          <PublishWizard notebookId={view.id} />
        ) : (
          <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
            {view.kind !== "workflow" && view.kind !== "notebook" && (
              <div className="flex shrink-0 items-center border-b px-2 py-1">{explorerButton}</div>
            )}
            {view.kind === "workflow" ? (
              <EditorProvider key={view.id} store={workflowSession(view.id)}>
                <WorkflowEditor workflowId={view.id} explorerControl={explorerButton} />
              </EditorProvider>
            ) : view.kind === "file" ? (
              <TextEditor key={view.id} path={view.id} />
            ) : view.kind === "notebook" ? (
              // The editor and the assistant both work on the open notebook's session.
              <NotebookSessionProvider key={view.id} notebookId={view.id}>
                <NotebookAssistant />
                <NotebookConflict id={view.id} />
                <NotebookEditor notebookId={view.id} explorerControl={explorerButton} />
              </NotebookSessionProvider>
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
