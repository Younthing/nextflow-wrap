"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  type Connection,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { resolveNodeDef } from "@/features/workflow/catalog";
import { checkCompatibility, findPort } from "@/features/workflow/ports";
import { EDITOR_CANVAS_CLASS, isEditableTarget } from "@/lib/actions";
import { useShortcutLabels } from "@/lib/use-action-shortcuts";
import { selectionForContextTarget } from "../canvas-menu";
import { EDITOR_ACTIONS } from "../commands";
import {
  MARQUEE_TEXT_CLASS,
  beginMarqueeTextGuard,
  clearMarqueeTextSelection,
  isCanvasMarqueePointerDown,
  releaseMarqueeTextGuard,
  shouldPreventMarqueeSelectStart,
} from "../marquee-text";
import { fitViewOptions } from "../fit-view";
import { categoryColor, portColor } from "../port-style";
import { useEditorStore, type FlowEdge, type FlowNode } from "../store";
import { toast } from "../toast";
import { CanvasContextMenu } from "./canvas-context-menu";
import { MODULE_DRAG_TYPE } from "./module-library";
import { ModuleNode } from "./module-node";
import type { SearchRequest } from "./node-search-dialog";

const nodeTypes = { module: ModuleNode };

export function WorkflowCanvas({
  onRequestSearch,
}: {
  onRequestSearch: (request: SearchRequest) => void;
}) {
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const index = useEditorStore((s) => s.index);
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
  const onEdgesChange = useEditorStore((s) => s.onEdgesChange);
  const connect = useEditorStore((s) => s.connect);
  const checkConnection = useEditorStore((s) => s.checkConnection);
  const beginChange = useEditorStore((s) => s.beginChange);
  const addNode = useEditorStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();
  const flowStore = useStoreApi();
  const fitKeys = useShortcutLabels(EDITOR_ACTIONS.fit.shortcut);

  // Edges take the colour of the channel they carry; dubious links are dashed.
  const styledEdges = React.useMemo<FlowEdge[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges.map((e) => {
      const src = byId.get(e.source);
      const dst = byId.get(e.target);
      const srcDef = src && resolveNodeDef(index, src.data);
      const dstDef = dst && resolveNodeDef(index, dst.data);
      const out = srcDef && findPort(srcDef, e.sourceHandle, "out");
      const inp = dstDef && findPort(dstDef, e.targetHandle, "in");
      const compat = out && inp ? checkCompatibility(out, inp) : { ok: false };
      const disabled = src?.data.disabled || dst?.data.disabled;
      return {
        ...e,
        style: {
          stroke: !compat.ok ? "var(--destructive)" : out ? portColor(out) : undefined,
          strokeWidth: 2,
          strokeDasharray: !compat.ok || compat.warning ? "6 4" : undefined,
          opacity: disabled ? 0.35 : 1,
        },
      };
    });
  }, [edges, nodes, index]);

  const onConnect = React.useCallback(
    (c: Connection) => {
      const result = connect(c);
      if (!result.ok) toast.error(result.reason ?? "无法连接");
      else if (result.warning) toast.warning(result.warning);
    },
    [connect],
  );

  const onConnectEnd = React.useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid || state.toNode || !state.fromNode || !state.fromHandle) return;
      const fromNode = state.fromNode as unknown as FlowNode;
      const def = resolveNodeDef(index, fromNode.data);
      const side = state.fromHandle.type;
      const port = def && findPort(def, state.fromHandle.id, side === "source" ? "out" : "in");
      if (!port) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      onRequestSearch({
        position: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        from: { nodeId: fromNode.id, port, side },
      });
    },
    [index, onRequestSearch, screenToFlowPosition],
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(MODULE_DRAG_TYPE);
      const def = id && index.get(id);
      if (!def) return;
      e.preventDefault();
      addNode(def, screenToFlowPosition({ x: e.clientX - 120, y: e.clientY - 20 }));
    },
    [addNode, index, screenToFlowPosition],
  );

  const onNodeContextMenu = React.useCallback((_event: React.MouseEvent, node: FlowNode) => {
    const { nodes: current, edges: currentEdges } = useEditorStore.getState();
    const next = selectionForContextTarget(current, currentEdges, node.id);
    if (!next) return;
    useEditorStore.setState(next);
    // A shift-drag leaves React Flow's selection rectangle up. Retargeting the
    // selection to one node does not clear that flag, so the rectangle stays
    // on top of the node. A node that was already selected keeps the rectangle.
    flowStore.setState({ nodesSelectionActive: false });
  }, [flowStore]);

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const marqueeRef = React.useRef(false);
  const releaseMarquee = React.useCallback(() => {
    if (!marqueeRef.current) return;
    marqueeRef.current = false;
    releaseMarqueeTextGuard(document, () => marqueeRef.current, requestAnimationFrame);
  }, []);

  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // Widget inputs sit on the canvas. Their contextmenu bubbles to the Radix
    // trigger, which would copy nodes instead of the field text. Stop it here,
    // before React's root listener, so the browser text menu still opens.
    const allowTextMenu = (event: Event) => {
      if (isEditableTarget(event.target)) event.stopPropagation();
    };
    // selectstart on the pane is the browser starting a text range. Panels
    // outside the pane can receive it too, because the flow viewport is
    // transformed, so the same cancel listens on the document while the
    // marquee gesture is down.
    const blockMarqueeSelect = (event: Event) => {
      if (!shouldPreventMarqueeSelectStart(marqueeRef.current, event.target)) return;
      event.preventDefault();
      clearMarqueeTextSelection(document);
    };
    surface.addEventListener("contextmenu", allowTextMenu);
    surface.addEventListener("selectstart", blockMarqueeSelect, true);
    document.addEventListener("selectstart", blockMarqueeSelect, true);
    window.addEventListener("pointerup", releaseMarquee);
    window.addEventListener("pointercancel", releaseMarquee);
    window.addEventListener("blur", releaseMarquee);
    return () => {
      surface.removeEventListener("contextmenu", allowTextMenu);
      surface.removeEventListener("selectstart", blockMarqueeSelect, true);
      document.removeEventListener("selectstart", blockMarqueeSelect, true);
      window.removeEventListener("pointerup", releaseMarquee);
      window.removeEventListener("pointercancel", releaseMarquee);
      window.removeEventListener("blur", releaseMarquee);
      marqueeRef.current = false;
      document.documentElement.classList.remove(MARQUEE_TEXT_CLASS);
    };
  }, [releaseMarquee]);

  return (
    <CanvasContextMenu>
      <div
        ref={surfaceRef}
        className={`${EDITOR_CANVAS_CLASS} size-full`}
        onPointerDownCapture={(event) => {
          if (!isCanvasMarqueePointerDown(event)) return;
          marqueeRef.current = true;
          beginMarqueeTextGuard(document);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("react-flow__pane")) {
            onRequestSearch({ position: screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
          }
        }}
      >
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={(c) => checkConnection(c).ok}
          onNodeDragStart={() => beginChange()}
          onSelectionStart={() => {
            marqueeRef.current = true;
            beginMarqueeTextGuard(document);
          }}
          onSelectionEnd={releaseMarquee}
          onNodeContextMenu={onNodeContextMenu}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(MODULE_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={onDrop}
          zoomOnDoubleClick={false}
          // Delete and Backspace are Comfy.Canvas.DeleteSelectedItems. Leaving
          // React Flow's handler on would remove the same selection again.
          deleteKeyCode={null}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          minZoom={0.2}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          ariaLabelConfig={{
            "controls.fitView.ariaLabel": `${EDITOR_ACTIONS.fit.label}（${fitKeys}）`,
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--canvas-dot)" />
          <MiniMap<FlowNode>
            pannable
            zoomable
            nodeColor={(n) => categoryColor(index.get(n.data.moduleId)?.category ?? "")}
            bgColor="transparent"
            maskColor="color-mix(in oklch, var(--foreground) 8%, transparent)"
            className="!glass !rounded-lg"
          />
          <Controls className="!glass !rounded-lg !shadow-none" fitViewOptions={fitViewOptions(nodes)} />
        </ReactFlow>
      </div>
    </CanvasContextMenu>
  );
}
