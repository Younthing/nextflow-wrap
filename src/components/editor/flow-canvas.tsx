"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";

export interface FlowCanvasProps {
  nodes?: Node[];
  edges?: Edge[];
  className?: string;
}

export function FlowCanvas({ nodes = [], edges = [], className }: FlowCanvasProps) {
  return (
    <div className={cn("nf-canvas size-full", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="var(--canvas-dot)"
        />
        <MiniMap pannable zoomable className="!glass !rounded-lg" />
        <Controls className="!glass !rounded-lg !shadow-none" />
      </ReactFlow>
    </div>
  );
}
