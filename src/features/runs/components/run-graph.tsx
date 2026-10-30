"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { categoryColor } from "@/features/editor/port-style";
import { resolveNodeDef, type ModuleIndex } from "@/features/workflow/catalog";
import type { WorkflowDoc } from "@/features/workflow/types";
import { cn } from "@/lib/utils";
import { TASK_STATUS } from "../format";
import type { TaskRecord, TaskStatus } from "../types";

interface StatusNodeData extends Record<string, unknown> {
  alias: string;
  title: string;
  category: string;
  builtin: boolean;
  counts: Partial<Record<TaskStatus, number>>;
  total: number;
  failed: boolean;
}

type StatusFlowNode = Node<StatusNodeData, "status">;

function StatusNode({ data, selected }: NodeProps<StatusFlowNode>) {
  const { counts, total } = data;
  const done = (counts.completed ?? 0) + (counts.cached ?? 0);
  const running = (counts.running ?? 0) + (counts.submitted ?? 0);
  const failed = counts.failed ?? 0;
  const aborted = counts.aborted ?? 0;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const state = failed ? "failed" : running ? "running" : total && done === total ? "done" : "idle";

  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card/90 shadow-sm backdrop-blur transition-shadow",
        state === "running" && "border-primary/60 shadow-[0_0_0_3px] shadow-primary/15",
        state === "failed" && "border-destructive/70 shadow-[0_0_0_3px] shadow-destructive/15",
        state === "done" && "border-success/50",
        selected && "ring-2 ring-ring",
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground/50" />
      <div className="flex items-center gap-2 rounded-t-xl px-3 py-2" style={{ background: `color-mix(in oklch, ${categoryColor(data.category)} 16%, transparent)` }}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(data.category) }} />
        <span className="truncate font-mono text-xs font-semibold">{data.alias}</span>
        <span className="ml-auto">
          {state === "running" && <Loader2 className="size-3.5 animate-spin text-primary" />}
          {state === "done" && <CheckCircle2 className="size-3.5 text-success" />}
          {state === "failed" && <XCircle className="size-3.5 text-destructive" />}
        </span>
      </div>
      <div className="grid gap-1.5 px-3 py-2">
        <span className="truncate text-[11px] text-muted-foreground">{data.title}</span>
        {data.builtin ? (
          <span className="text-[11px] text-muted-foreground">输入，不产生任务</span>
        ) : (
          <>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="bg-success transition-[width] duration-500" style={{ width: pct(done) }} />
              <div className="bg-destructive transition-[width] duration-500" style={{ width: pct(failed) }} />
              <div className="bg-warning transition-[width] duration-500" style={{ width: pct(aborted) }} />
              <div className="animate-pulse bg-primary transition-[width] duration-500" style={{ width: pct(running) }} />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {total ? `${done}/${total}` : "等待上游"}
              {running > 0 && <span className="text-primary"> · {running} 运行</span>}
              {failed > 0 && <span className="text-destructive"> · {failed} 失败</span>}
              {aborted > 0 && <span className="text-warning"> · {aborted} {TASK_STATUS.aborted.label}</span>}
            </span>
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-muted-foreground/50" />
    </div>
  );
}

const nodeTypes = { status: StatusNode };

function buildGraph(workflow: WorkflowDoc, tasks: TaskRecord[], index: ModuleIndex) {
  const byNode = new Map<string, TaskRecord[]>();
  for (const t of tasks) byNode.set(t.nodeId, [...(byNode.get(t.nodeId) ?? []), t]);

  const nodes: StatusFlowNode[] = workflow.nodes
    .filter((n) => !n.data.disabled)
    .map((n) => {
      const def = resolveNodeDef(index, n.data);
      const own = byNode.get(n.id) ?? [];
      const counts: StatusNodeData["counts"] = {};
      for (const t of own) counts[t.status] = (counts[t.status] ?? 0) + 1;
      return {
        id: n.id,
        type: "status",
        position: n.position,
        draggable: false,
        data: {
          alias: n.data.alias,
          title: def?.builtin ? def.name : (def?.description.split(/[.\n]/)[0] ?? ""),
          category: def?.category ?? "工具",
          builtin: !!def?.builtin,
          counts,
          total: own.length,
          failed: !!counts.failed,
        },
      };
    });

  const ids = new Set(nodes.map((n) => n.id));
  const active = new Set(tasks.filter((t) => t.status === "running" || t.status === "submitted").map((t) => t.nodeId));
  const edges: Edge[] = workflow.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: active.has(e.target),
      style: { strokeWidth: 1.5 },
    }));
  return { nodes, edges };
}

export function RunGraph({
  workflow,
  tasks,
  index,
  onSelectNode,
  className,
}: {
  workflow: WorkflowDoc;
  tasks: TaskRecord[];
  index: ModuleIndex;
  onSelectNode?: (nodeId: string) => void;
  className?: string;
}) {
  const { nodes, edges } = React.useMemo(() => buildGraph(workflow, tasks, index), [workflow, tasks, index]);
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-secondary/30", className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={!!onSelectNode}
          onNodeClick={(_, node) => onSelectNode?.(node.id)}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
