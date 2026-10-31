"use client";

import * as React from "react";
import Link from "next/link";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EditorAssistant } from "@/features/assistant/editor-assistant";
import { RunDialog } from "@/features/runs/components/run-dialog";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { useModuleCatalog, useSaveWorkflow, useWorkflow } from "@/features/workflow/queries";
import { keepLocalWorkflowEdits } from "@/features/workflow/revision";
import type { WorkflowDoc } from "@/features/workflow/types";
import { validateWorkflow } from "@/features/workflow/validate";
import { api } from "@/lib/api";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { EDITOR_ACTIONS } from "../commands";
import { editorEchoKeepsLocalEdits, enqueueEditorSave, runEditorSave, type EditorSaveRead } from "../editor-save";
import { fitViewOptions } from "../fit-view";
import { selectIsDirty, useEditorStore } from "../store";
import { toast } from "../toast";
import { useEditorCommands } from "../use-editor-commands";
import { EditorToolbar } from "./editor-toolbar";
import { Inspector } from "./inspector";
import { ModuleLibrary } from "./module-library";
import { NodeSearchDialog, type SearchPick, type SearchRequest } from "./node-search-dialog";
import { Toaster } from "./toaster";
import { WorkflowCanvas } from "./workflow-canvas";

const AUTOSAVE_MS = 1500;

/**
 * The editor store outlives the route. This token records that the current
 * screen has loaded its workflow. A ref cannot be read while rendering, and
 * setting React state from the load effect is rejected by the hooks lint.
 */
type AppliedWorkflow = { id: string | null; token: symbol | null; version: number };
const SERVER_APPLIED: AppliedWorkflow = { id: null, token: null, version: 0 };
let appliedWorkflow: AppliedWorkflow = SERVER_APPLIED;
const appliedListeners = new Set<() => void>();

function markWorkflowApplied(id: string, token: symbol) {
  appliedWorkflow = { id, token, version: appliedWorkflow.version + 1 };
  appliedListeners.forEach((listener) => listener());
}

function subscribeAppliedWorkflow(listener: () => void) {
  appliedListeners.add(listener);
  return () => appliedListeners.delete(listener);
}

function useAppliedWorkflow() {
  return React.useSyncExternalStore(subscribeAppliedWorkflow, () => appliedWorkflow, () => SERVER_APPLIED);
}

function editorIssues(
  state: Pick<ReturnType<typeof useEditorStore.getState>, "nodes" | "edges" | "params" | "index">,
) {
  if (!state.index.size) return [];
  return validateWorkflow(
    state.nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
    state.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? "", targetHandle: e.targetHandle ?? "" })),
    state.params,
    state.index,
  );
}

function EditorLoading() {
  return (
    <div className="glass grid size-full place-items-center rounded-xl text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> 加载模块库和流程…
      </span>
    </div>
  );
}

function EditorNotice({
  message,
  tone = "muted",
  children,
}: {
  message: string;
  tone?: "muted" | "danger";
  children?: React.ReactNode;
}) {
  return (
    <div className="glass flex size-full flex-col items-center justify-center gap-3 rounded-xl text-sm">
      <span className={tone === "danger" ? "text-destructive" : "text-muted-foreground"}>{message}</span>
      {children}
    </div>
  );
}

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
  const save = useSaveWorkflow();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [search, setSearch] = React.useState<SearchRequest | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);
  const [mountToken] = React.useState(() => Symbol("workflow-editor"));
  const applied = useAppliedWorkflow();

  const store = useEditorStore;
  const docId = useEditorStore((s) => s.docId);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const params = useEditorStore((s) => s.params);
  const index = useEditorStore((s) => s.index);
  const revision = useEditorStore((s) => s.revision);
  const dirty = useEditorStore(selectIsDirty);

  React.useEffect(() => {
    if (catalog.data) store.getState().setIndex(catalog.data.index);
  }, [catalog.data, store]);

  React.useEffect(() => {
    const doc = workflow.data;
    if (!doc || doc.id !== workflowId) return;
    const state = store.getState();
    const appliedThisMount = applied.id === workflowId && applied.token === mountToken;
    // A save echo for the revision we already have must not reload the canvas.
    if (appliedThisMount && state.updatedAt === doc.updatedAt) return;
    // Our own departing save minted this revision. It is not an external edit.
    if (editorEchoKeepsLocalEdits(
      { docId: state.docId, dirty: selectIsDirty(state) },
      doc,
    )) {
      markWorkflowApplied(workflowId, mountToken);
      return;
    }
    // Dirty edits stay only while the server revision they were based on is still current.
    if (!keepLocalWorkflowEdits(
      { docId: state.docId, updatedAt: state.updatedAt, dirty: selectIsDirty(state) },
      doc,
    )) {
      store.getState().load(doc);
    }
    markWorkflowApplied(workflowId, mountToken);
  }, [workflow.data, workflowId, store, applied.id, applied.token, mountToken]);

  const doSave = React.useCallback(
    (silent = false) => {
      // Capture this workflow now. A queued save must not read whatever document
      // is in the shared store when the previous request finally finishes.
      const state = store.getState();
      const snapshot: EditorSaveRead = {
        docId: state.docId,
        revision: state.revision,
        generation: state.generation,
        dirty: selectIsDirty(state),
        doc: state.toDoc(),
        issues: editorIssues(state),
      };
      enqueueEditorSave(silent, (announce) => runEditorSave({
        announce,
        snapshot,
        save: (doc) => save.mutateAsync(doc),
        markSaved: (revision, updatedAt) => store.getState().markSaved(revision, updatedAt),
        stillOpen: (generation, docId) => {
          const current = store.getState();
          return current.generation === generation && current.docId === docId;
        },
        fetchCurrent: (id) => api<WorkflowDoc>(`/workflows/${id}`),
        load: (doc) => store.getState().load(doc),
        toastSaved: (tone, message) => (tone === "warning" ? toast.warning(message) : toast.success(message)),
        toastError: (message) => toast.error(message),
      }));
    },
    [save, store],
  );

  // Autosave saved workflows shortly after each edit, like ComfyUI does.
  React.useEffect(() => {
    if (!dirty || !docId) return;
    const t = setTimeout(() => doSave(true), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, docId, revision, doSave]);

  const doSaveRef = React.useRef(doSave);
  React.useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);
  React.useEffect(() => {
    return () => {
      const state = useEditorStore.getState();
      if (selectIsDirty(state) && state.docId) doSaveRef.current(true);
    };
  }, []);

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
    requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1, duration: 300 }));
  }, [fitView]);

  const addAtCenter = (def: (typeof modules)[number]) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const jitter = () => (Math.random() - 0.5) * 80;
    store.getState().addNode(
      def,
      screenToFlowPosition({ x: rect.left + rect.width / 2 - 128 + jitter(), y: rect.top + rect.height / 2 - 60 + jitter() }),
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
          ? state.connect({ source: from.nodeId, sourceHandle: `out:${from.port.name}`, target: node.id, targetHandle: `in:${port}` })
          : state.connect({ source: node.id, sourceHandle: `out:${port}`, target: from.nodeId, targetHandle: `in:${from.port.name}` });
      if (result.warning) toast.warning(result.warning);
    }
    setSearch(null);
  };

  if (catalog.isPending || workflow.isPending) return <EditorLoading />;
  if (workflow.isError) {
    return (
      <EditorNotice message={`加载失败：${workflow.error.message}`} tone="danger">
        <BackToLibrary />
      </EditorNotice>
    );
  }
  if (workflow.data === null) {
    return (
      <EditorNotice message="这个流程不存在或已被删除">
        <BackToLibrary />
      </EditorNotice>
    );
  }
  if (applied.token !== mountToken || applied.id !== workflowId) return <EditorLoading />;

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
          saving={save.isPending}
          onFit={fitWorkflow}
          onRun={() => {
            if (store.getState().docId && selectIsDirty(store.getState())) doSave(true);
            setRunOpen(true);
          }}
        />
        <section ref={canvasRef} className="glass relative min-h-0 flex-1 overflow-hidden rounded-xl">
          <WorkflowCanvas onRequestSearch={setSearch} />
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="glass max-w-sm rounded-xl px-8 py-6 text-center">
                <div className="font-serif text-lg font-semibold">从空白画布开始</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  从左侧模块库拖入模块，或双击画布搜索（{searchKeys}）。先放一个「样本表」作为输入。
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
      <Inspector className="w-80 shrink-0" />
      <NodeSearchDialog request={search} modules={modules} onPick={onPick} onClose={() => setSearch(null)} />
      <RunDialog open={runOpen} onOpenChange={setRunOpen} issues={issues} modulesSha={catalog.data?.gitSha ?? ""} />
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

export function WorkflowEditorRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <WorkflowEditor workflowId={id} />;
}
