"use client";

import * as React from "react";
import Link from "next/link";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { PanelLoading, PanelNotice } from "@/components/ui/panel-notice";

import { Button } from "@/components/ui/button";
import { EditorAssistant } from "@/features/assistant/editor-assistant";
import { RunDialog } from "@/features/runs/components/run-dialog";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { useModuleCatalog, useWorkflow } from "@/features/workflow/queries";
import {
  keepLocalWorkflowEdits,
  revisionIsOlder,
} from "@/features/workflow/revision";
import { editorIssues } from "../issues";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { EDITOR_ACTIONS } from "../commands";
import { getEditorSaveSession } from "../editor-save";
import { fitViewOptions } from "../fit-view";
import { selectIsDirty } from "../store";
import {
  useEditorStore,
  useEditorStoreApi,
} from "@/features/editor/editor-provider";
import { toast } from "../toast";
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
import { Toaster } from "./toaster";
import { WorkflowCanvas } from "./workflow-canvas";

function BackToLibrary() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/workflows">返回流程库</Link>
    </Button>
  );
}

function Editor({ workflowId }: { workflowId: string }) {
  const catalog = useModuleCatalog();
  const workflow = useWorkflow(workflowId);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [search, setSearch] = React.useState<SearchRequest | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);
  const [mountToken] = React.useState(() => Symbol("workflow-editor"));
  const applied = useEditorStore((s) => s.appliedWorkflow);

  const store = useEditorStoreApi();
  const saveSession = getEditorSaveSession(store);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const params = useEditorStore((s) => s.params);
  const index = useEditorStore((s) => s.index);

  React.useEffect(() => {
    if (catalog.data) store.getState().setIndex(catalog.data.index);
  }, [catalog.data, store]);

  React.useEffect(() => {
    const doc = workflow.data;
    if (!doc || doc.id !== workflowId) return;
    const state = store.getState();
    const appliedThisMount =
      applied.id === workflowId && applied.token === mountToken;
    // A save echo for the revision we already have must not reload the canvas.
    if (appliedThisMount && state.updatedAt === doc.updatedAt) return;
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

  const modules = React.useMemo(
    () => [...BUILTIN_MODULES, ...(catalog.data?.modules ?? [])],
    [catalog.data],
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
  if (workflow.data === null) {
    return (
      <PanelNotice message="这个流程不存在或已被删除">
        <BackToLibrary />
      </PanelNotice>
    );
  }
  if (applied.token !== mountToken || applied.id !== workflowId)
    return <PanelLoading message="加载模块库和流程…" />;

  return (
    <div className="flex size-full gap-3">
      <ModuleLibrary
        modules={modules}
        syncedAt={catalog.data?.syncedAt}
        onAdd={addAtCenter}
        className="w-60 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <EditorToolbar
          saving={saving}
          onFit={fitWorkflow}
          onRun={() => {
            if (store.getState().docId && selectIsDirty(store.getState()))
              doSave(true);
            setRunOpen(true);
          }}
        />
        <section
          ref={canvasRef}
          className="glass relative min-h-0 flex-1 overflow-hidden rounded-xl"
        >
          <WorkflowCanvas onRequestSearch={setSearch} />
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="glass max-w-sm rounded-xl px-8 py-6 text-center">
                <div className="font-serif text-lg font-semibold">
                  从空白画布开始
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  从左侧模块库拖入模块，或双击画布搜索（{searchKeys}
                  ）。先放一个「样本表」作为输入。
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
      <Inspector className="w-80 shrink-0" />
      <NodeSearchDialog
        request={search}
        modules={modules}
        onPick={onPick}
        onClose={() => setSearch(null)}
      />
      <RunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        issues={issues}
        modulesSha={catalog.data?.gitSha ?? ""}
      />
      <EditorAssistant onCanvasChange={onAssistantChange} />
      <Toaster />
    </div>
  );
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  return (
    <ReactFlowProvider key={workflowId}>
      <Editor workflowId={workflowId} />
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
