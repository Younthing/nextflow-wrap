"use client";

import * as React from "react";
import Link from "next/link";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { LibraryBig, PanelRight } from "lucide-react";
import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";

import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { usePanel } from "@/components/layout/layout-store";
import { EditorAssistant } from "@/features/assistant/surfaces/canvas";
import { ExportProjectDialog } from "@/features/runs/components/export-project-dialog";
import { RunSettingsDialog } from "@/features/runs/components/run-settings-dialog";
import { useRunNow } from "@/features/runs/use-run-now";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { modulesForDrawer } from "@/features/workflow/origin";
import { useModuleCatalog, useWorkflow } from "@/features/workflow/queries";
import {
  keepLocalWorkflowEdits,
  revisionIsOlder,
} from "@/features/workflow/revision";
import { editorIssues } from "../issues";
import { NodeIssuesProvider } from "../node-issues";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { EDITOR_ACTIONS } from "../commands";
import { getEditorSaveSession } from "../editor-save";
import { fitViewOptions } from "../fit-view";
import { selectIsDirty } from "../store";
import {
  useEditorStore,
  useEditorStoreApi,
} from "@/features/editor/editor-provider";
import { toast } from "@/lib/toast";
import { useCompactLayout } from "@/lib/use-compact-layout";
import { cn } from "@/lib/utils";
import { useEditorAutosave } from "../use-editor-autosave";
import { useEditorCommands } from "../use-editor-commands";
import { EditorToolbar } from "./editor-toolbar";
import { Inspector } from "./inspector";
import { ModuleLibrary } from "./module-library";
import {
  NodeSearchDialog,
  type SearchPick,
  type SearchRequest,
} from "./node-search-dialog";
import { WorkflowConflict } from "@/features/workbench/components/document-conflict";
import { WorkflowCanvas } from "./workflow-canvas";

function BackToLibrary() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/workflows">返回流程库</Link>
    </Button>
  );
}

function Editor({ workflowId, explorerControl }: { workflowId: string; explorerControl?: React.ReactNode }) {
  const catalog = useModuleCatalog();
  const workflow = useWorkflow(workflowId);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [search, setSearch] = React.useState<SearchRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string>();
  const [exportOpen, setExportOpen] = React.useState(false);
  const { ref: editorRef, compact } = useCompactLayout(1260);
  const { ref: panelsRef, compact: compactLibrary } = useCompactLayout(680, false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [inspectorOverride, setInspectorOverride] = React.useState<boolean>();
  const inspectorOpen = inspectorOverride ?? !compact;
  const inspector = usePanel("inspector");
  const panelId = React.useId();
  const [mountToken] = React.useState(() => Symbol("workflow-editor"));
  const applied = useEditorStore((s) => s.appliedWorkflow);

  const store = useEditorStoreApi();
  const saveSession = getEditorSaveSession(store);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const params = useEditorStore((s) => s.params);
  const index = useEditorStore((s) => s.index);

  React.useEffect(() => {
    if (!catalog.data) return;
    store.getState().setIndex(catalog.data.index);
  }, [catalog.data, store]);

  React.useEffect(() => {
    const doc = workflow.data;
    if (doc === null && store.getState().docId === workflowId && selectIsDirty(store.getState())) {
      store.setState({ conflict: "流程文件已删除，本地编辑已保留，请另存为副本" });
      return;
    }
    if (!doc || doc.id !== workflowId) return;
    const state = store.getState();
    const appliedThisMount =
      applied.id === workflowId && applied.token === mountToken;
    // A save echo for the revision we already have must not reload the canvas.
    if (appliedThisMount && state.updatedAt === doc.updatedAt && state.fileVersion === doc.fileVersion) return;
    if (state.docId === doc.id && selectIsDirty(state) && state.fileVersion !== doc.fileVersion) {
      store.setState({ conflict: "文件在外部被修改，本地编辑已保留", appliedWorkflow: { id: workflowId, token: mountToken } });
      return;
    }
    // A background GET can still resolve with the revision from before this save.
    if (
      state.docId === doc.id &&
      (revisionIsOlder(doc.updatedAt, state.updatedAt) ||
        revisionIsOlder(doc.updatedAt, saveSession.editorKnownRevision(doc.id)))
    ) {
      store.setState({
        appliedWorkflow: { id: workflowId, token: mountToken },
      });
      return;
    }
    // Our own departing save minted this revision. It is not an external edit.
    if (
      saveSession.editorEchoKeepsLocalEdits(
        { docId: state.docId, dirty: selectIsDirty(state) },
        doc,
      )
    ) {
      store.setState({
        appliedWorkflow: { id: workflowId, token: mountToken },
      });
      return;
    }
    // Dirty edits stay only while the server revision they were based on is still current.
    if (
      !keepLocalWorkflowEdits(
        {
          docId: state.docId,
          updatedAt: state.updatedAt,
          dirty: selectIsDirty(state),
        },
        doc,
      )
    ) {
      store.getState().load(doc);
    }
    store.setState({ appliedWorkflow: { id: workflowId, token: mountToken } });
  }, [
    workflow.data,
    workflowId,
    store,
    saveSession,
    applied.id,
    applied.token,
    mountToken,
  ]);

  const { doSave, saving } = useEditorAutosave();

  const openNodeSearch = React.useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSearch({
      position: screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }),
    });
  }, [screenToFlowPosition]);

  const fitWorkflow = React.useCallback(() => {
    void fitView(fitViewOptions(store.getState().nodes));
  }, [fitView, store]);

  useEditorCommands({ save: doSave, openNodeSearch, fitView: fitWorkflow });

  const searchKeys = useShortcutLabels(EDITOR_ACTIONS.search.shortcut);

  const issues = React.useMemo(
    () => editorIssues({ nodes, edges, params, index }),
    [nodes, edges, params, index],
  );

  // Select the node a run is blocked on and bring it into view.
  const focusNode = React.useCallback(
    (nodeId: string) => {
      store.setState((state) => ({
        nodes: state.nodes.map((node) =>
          node.selected === (node.id === nodeId) ? node : { ...node, selected: node.id === nodeId },
        ),
      }));
      void fitView({ nodes: [{ id: nodeId }], maxZoom: 1, duration: 300 });
    },
    [store, fitView],
  );

  const { runNow, pending: runPending } = useRunNow({
    issues,
    onNodeIssue: focusNode,
    onNeedsSettings: (error) => {
      setLaunchError(error);
      setSettingsOpen(true);
    },
  });

  const saveFirst = () => {
    if (store.getState().docId && selectIsDirty(store.getState())) doSave(true);
  };

  const modules = React.useMemo(
    () => [...BUILTIN_MODULES, ...(catalog.data?.modules ?? [])],
    [catalog.data],
  );
  const searchable = React.useMemo(
    () => modulesForDrawer(modules),
    [modules],
  );

  // Keep nodes the assistant adds in view.
  const onAssistantChange = React.useCallback(() => {
    requestAnimationFrame(
      () => void fitView({ padding: 0.2, maxZoom: 1, duration: 300 }),
    );
  }, [fitView]);

  const addAtCenter = (def: (typeof modules)[number]) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const jitter = () => (Math.random() - 0.5) * 80;
    store
      .getState()
      .addNode(
        def,
        screenToFlowPosition({
          x: rect.left + rect.width / 2 - 128 + jitter(),
          y: rect.top + rect.height / 2 - 60 + jitter(),
        }),
      );
  };

  const onPick = ({ def, port }: SearchPick) => {
    if (!search) return;
    const state = store.getState();
    const node = state.addNode(def, search.position);
    const from = search.from;
    if (from && port) {
      const result =
        from.side === "source"
          ? state.connect({
              source: from.nodeId,
              sourceHandle: `out:${from.port.name}`,
              target: node.id,
              targetHandle: `in:${port}`,
            })
          : state.connect({
              source: node.id,
              sourceHandle: `out:${port}`,
              target: from.nodeId,
              targetHandle: `in:${from.port.name}`,
            });
      if (result.warning) toast.warning(result.warning);
    }
    setSearch(null);
  };

  if (catalog.isPending || workflow.isPending)
    return <PanelLoading message="加载模块库和流程…" />;
  if (catalog.isError || workflow.isError) {
    return (
      <PanelNotice
        message={`加载失败：${(catalog.error ?? workflow.error)?.message}`}
        tone="danger"
      >
        <BackToLibrary />
      </PanelNotice>
    );
  }
  if (workflow.data === null && !selectIsDirty(store.getState())) {
    return (
      <PanelNotice message="这个流程不存在或已被删除">
        <BackToLibrary />
      </PanelNotice>
    );
  }
  if (applied.token !== mountToken || applied.id !== workflowId)
    return <PanelLoading message="加载模块库和流程…" />;

  return (
    <div ref={editorRef} className="flex min-h-0 flex-1 flex-col gap-3 p-2">
      <WorkflowConflict id={workflowId} />
      <EditorToolbar
        saving={saving}
        onFit={fitWorkflow}
        running={runPending}
        onRun={() => {
          saveFirst();
          void runNow();
        }}
        onRunSettings={() => {
          saveFirst();
          setLaunchError(undefined);
          setSettingsOpen(true);
        }}
        onExport={() => setExportOpen(true)}
        leadingControls={<>
          {explorerControl}
          {compactLibrary && (
            <Button type="button" size="icon-sm" variant="ghost" aria-label="模块库" title="模块库" aria-expanded={libraryOpen} aria-controls={`${panelId}-library`} onClick={() => {
              setLibraryOpen(!libraryOpen);
              if (!libraryOpen) setInspectorOverride(false);
            }}>
              <LibraryBig />
            </Button>
          )}
        </>}
        trailingControls={(
          <Button type="button" size="icon-sm" variant="ghost" aria-label="参数面板" title="参数面板" aria-expanded={inspectorOpen} aria-controls={`${panelId}-inspector`} onClick={() => {
            setInspectorOverride(!inspectorOpen);
            if (!inspectorOpen) setLibraryOpen(false);
          }}>
            <PanelRight />
          </Button>
        )}
      />
      <div ref={panelsRef} className="relative flex min-h-0 flex-1">
        <div id={`${panelId}-library`} className={cn(
          "mr-3 flex min-h-0 w-60 max-w-full shrink-0",
          compactLibrary && "absolute inset-y-0 left-0 z-20",
          compactLibrary && !libraryOpen && "hidden",
        )}>
          <ModuleLibrary modules={modules} onAdd={addAtCenter} className={cn("w-full", compactLibrary && "bg-background shadow-lg")} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <section
            ref={canvasRef}
            className="glass relative min-h-0 flex-1 overflow-hidden rounded-xl"
          >
            <NodeIssuesProvider issues={issues}>
              <WorkflowCanvas onRequestSearch={setSearch} />
            </NodeIssuesProvider>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="glass max-w-sm rounded-xl px-8 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    拖入模块，或双击搜索（{searchKeys}）
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
        <div className={cn("flex min-h-0 max-w-[min(85%,30rem)] shrink-0", compact && "absolute inset-y-0 right-0 z-20")}>
          <ResizeHandle panel="inspector" side="left" collapsed={!inspectorOpen} onCollapsedChange={(closed) => {
            setInspectorOverride(!closed);
            if (!closed) setLibraryOpen(false);
          }} showExpandButton={false} />
          <div id={`${panelId}-inspector`} className={cn("flex min-h-0 min-w-0", !inspectorOpen && "hidden")} style={{ width: inspector.width }}>
            <Inspector className={cn("w-full", compact && "bg-background shadow-lg")} />
          </div>
        </div>
      </div>
      <NodeSearchDialog
        request={search}
        modules={searchable}
        onPick={onPick}
        onClose={() => setSearch(null)}
      />
      <RunSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        issues={issues}
        launchError={launchError}
      />
      <ExportProjectDialog open={exportOpen} onOpenChange={setExportOpen} />
      <EditorAssistant onCanvasChange={onAssistantChange} onFocusNode={focusNode} />
    </div>
  );
}

export function WorkflowEditor({ workflowId, explorerControl }: { workflowId: string; explorerControl?: React.ReactNode }) {
  return (
    <ReactFlowProvider key={workflowId}>
      <Editor workflowId={workflowId} explorerControl={explorerControl} />
    </ReactFlowProvider>
  );
}

export function WorkflowEditorRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  return <WorkflowEditor workflowId={id} />;
}
