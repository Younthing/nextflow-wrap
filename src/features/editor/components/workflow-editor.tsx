"use client";

import * as React from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Loader2 } from "lucide-react";

import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { API_MOCKING_ENABLED } from "@/lib/mocking";
import { emptyWorkflow, parseWorkflowDoc } from "@/features/workflow/document";
import { useModuleCatalog, useSaveWorkflow, useWorkflow } from "@/features/workflow/queries";
import { validateWorkflow } from "@/features/workflow/validate";
import { EditorAssistant } from "@/features/assistant/editor-assistant";
import { RunDialog } from "@/features/runs/components/run-dialog";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { EDITOR_ACTIONS } from "../commands";
import { fitViewOptions } from "../fit-view";
import { saveConfirmation } from "../save-feedback";
import { selectIsDirty, useEditorStore } from "../store";
import { toast } from "../toast";
import { useEditorCommands } from "../use-editor-commands";
import { EditorToolbar } from "./editor-toolbar";
import { Inspector } from "./inspector";
import { ModuleLibrary } from "./module-library";
import { NodeSearchDialog, type SearchPick, type SearchRequest } from "./node-search-dialog";
import { Toaster } from "./toaster";
import { WorkflowCanvas } from "./workflow-canvas";

const CURRENT_KEY = "nf-studio-current-workflow";
const DEFAULT_WORKFLOW = API_MOCKING_ENABLED ? "wf_demo_rnaseq" : "qc-smoke";
const AUTOSAVE_MS = 1500;

function readCurrentId() {
  try {
    return localStorage.getItem(CURRENT_KEY) ?? DEFAULT_WORKFLOW;
  } catch {
    return DEFAULT_WORKFLOW;
  }
}

export function rememberCurrentId(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // Non-essential: the editor falls back to the demo workflow.
  }
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

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.workflow.json` });
  a.click();
  URL.revokeObjectURL(url);
}

function Editor() {
  const catalog = useModuleCatalog();
  const [currentId, setCurrentId] = React.useState<string>(readCurrentId);
  const workflow = useWorkflow(currentId || undefined);
  const save = useSaveWorkflow();
  const { fitView, setCenter, screenToFlowPosition } = useReactFlow();
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [search, setSearch] = React.useState<SearchRequest | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);

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

  // Load the requested workflow once it arrives (not when our own save echoes back).
  React.useEffect(() => {
    if (workflow.data === null) {
      toast.warning("找不到上次打开的流程，已新建空白流程");
      store.getState().load(emptyWorkflow(""));
    } else if (workflow.data && workflow.data.id !== store.getState().docId) {
      store.getState().load(workflow.data);
      requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1 }));
    }
  }, [workflow.data, store, fitView]);

  const doSave = React.useCallback(
    (silent = false) => {
      const state = store.getState();
      const rev = state.revision;
      const generation = state.generation;
      const confirmation = saveConfirmation(editorIssues(state));
      save.mutate(state.toDoc(), {
        onSuccess: (saved) => {
          const s = store.getState();
          // Another workflow was opened while saving: leave its identity alone.
          if (s.generation !== generation) return;
          if (!s.docId) useEditorStore.setState({ docId: saved.id });
          s.markSaved(rev);
          setCurrentId(saved.id);
          rememberCurrentId(saved.id);
          if (!silent) {
            if (confirmation.tone === "warning") toast.warning(confirmation.message);
            else toast.success(confirmation.message);
          }
        },
        onError: (err) => toast.error(`保存失败：${err.message}`),
      });
    },
    [save, store],
  );

  // Autosave saved workflows shortly after each edit, like ComfyUI does.
  React.useEffect(() => {
    if (!dirty || !docId) return;
    const t = setTimeout(() => doSave(true), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, docId, revision, doSave]);

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

  /** Saves (or confirms discarding) the open workflow before replacing it. */
  const leaveCurrent = () => {
    const state = store.getState();
    if (!selectIsDirty(state)) return true;
    if (state.docId) {
      doSave(true);
      return true;
    }
    return window.confirm("当前流程还没保存，确定要放弃这些修改吗？");
  };

  const onImport = async (file: File) => {
    if (!leaveCurrent()) return;
    try {
      const doc = parseWorkflowDoc(JSON.parse(await file.text()));
      store.getState().load({ ...doc, id: "" });
      useEditorStore.setState((s) => ({ revision: s.revision + 1 }));
      setCurrentId("");
      requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1 }));
      toast.info(`已导入「${doc.name}」，保存后会成为新流程`);
    } catch (err) {
      toast.error(`导入失败：${(err as Error).message}`);
    }
  };

  if (catalog.isPending || (currentId && workflow.isPending)) {
    return (
      <div className="glass grid size-full place-items-center rounded-xl text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> 加载模块库和流程…
        </span>
      </div>
    );
  }

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
          issues={issues}
          saving={save.isPending}
          onSave={() => doSave()}
          onOpen={(id) => {
            if (id === store.getState().docId || !leaveCurrent()) return;
            setCurrentId(id);
            rememberCurrentId(id);
          }}
          onNew={() => {
            if (!leaveCurrent()) return;
            store.getState().load(emptyWorkflow(""));
            setCurrentId("");
          }}
          onImport={onImport}
          onExport={() => {
            const doc = store.getState().toDoc();
            downloadJson(doc.name || "workflow", doc);
          }}
          onRun={() => {
            if (store.getState().docId && selectIsDirty(store.getState())) doSave(true);
            setRunOpen(true);
          }}
          onFocusNode={(id) => {
            const node = store.getState().nodes.find((n) => n.id === id);
            if (!node) return;
            useEditorStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === id })) }));
            void setCenter(node.position.x + 128, node.position.y + 80, { zoom: 1, duration: 400 });
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

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
