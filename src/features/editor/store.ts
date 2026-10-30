"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";

import { resolveNodeDef, type ModuleIndex } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import { createNode, newId } from "@/features/workflow/nodes";
import { checkCompatibility, findPort, type Compatibility } from "@/features/workflow/ports";
import type {
  ModuleDef,
  PipelineParams,
  ProjectSettings,
  WidgetValue,
  WorkflowDoc,
  WorkflowNodeData,
} from "@/features/workflow/types";

export type FlowNode = Node<WorkflowNodeData, "module">;
export type FlowEdge = Edge;

interface Snapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
  params: PipelineParams;
}

const HISTORY_LIMIT = 100;

interface EditorState {
  docId: string;
  name: string;
  description?: string;
  project?: ProjectSettings;
  params: PipelineParams;
  nodes: FlowNode[];
  edges: FlowEdge[];
  index: ModuleIndex;
  /** Bumped on every content change, compared against the last saved value. */
  revision: number;
  savedRevision: number;
  past: Snapshot[];
  future: Snapshot[];
  lastSnapshotKey?: string;

  setIndex: (index: ModuleIndex) => void;
  load: (doc: WorkflowDoc) => void;
  toDoc: () => WorkflowDoc;
  markSaved: (revision: number) => void;

  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  checkConnection: (connection: Connection | FlowEdge) => Compatibility;
  connect: (connection: Connection) => Compatibility;
  addNode: (def: ModuleDef, position: { x: number; y: number }) => FlowNode;
  updateNodeData: (id: string, patch: Partial<WorkflowNodeData>, historyKey?: string) => void;
  setWidget: (id: string, name: string, value: WidgetValue) => void;
  removeNodes: (ids: string[]) => void;
  setName: (name: string) => void;
  setProject: (project: ProjectSettings) => void;
  setParam: (key: string, value: WidgetValue | undefined) => void;

  beginChange: (key?: string) => void;
  undo: () => void;
  redo: () => void;
}

function toFlowNode(n: WorkflowDoc["nodes"][number]): FlowNode {
  return { id: n.id, type: "module", position: n.position, data: n.data };
}

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Applies a content change and bumps the revision. */
  const commit = (patch: Partial<EditorState>) =>
    set((s) => ({ ...patch, revision: s.revision + 1 }));

  return {
    ...(() => {
      const doc = emptyWorkflow("");
      return { docId: doc.id, name: doc.name, params: doc.params };
    })(),
    nodes: [],
    edges: [],
    index: new Map(),
    revision: 0,
    savedRevision: 0,
    past: [],
    future: [],

    setIndex: (index) => set({ index }),

    load: (doc) =>
      set({
        docId: doc.id,
        name: doc.name,
        description: doc.description,
        project: doc.project,
        params: doc.params,
        nodes: doc.nodes.map(toFlowNode),
        edges: doc.edges.map((e) => ({ ...e })),
        revision: 0,
        savedRevision: 0,
        past: [],
        future: [],
        lastSnapshotKey: undefined,
      }),

    toDoc: () => {
      const s = get();
      return {
        id: s.docId,
        name: s.name,
        description: s.description,
        project: s.project,
        version: 1,
        params: s.params,
        nodes: s.nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
        edges: s.edges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle ?? "",
          target: e.target,
          targetHandle: e.targetHandle ?? "",
        })),
        updatedAt: new Date().toISOString(),
      };
    },

    markSaved: (revision) => set({ savedRevision: revision }),

    beginChange: (key) => {
      const s = get();
      // Consecutive edits to the same field collapse into one undo step.
      if (key && key === s.lastSnapshotKey) return;
      const snap: Snapshot = { nodes: s.nodes, edges: s.edges, params: s.params };
      set({
        past: [...s.past, snap].slice(-HISTORY_LIMIT),
        future: [],
        lastSnapshotKey: key,
      });
    },

    undo: () => {
      const s = get();
      const prev = s.past.at(-1);
      if (!prev) return;
      commit({
        ...prev,
        past: s.past.slice(0, -1),
        future: [{ nodes: s.nodes, edges: s.edges, params: s.params }, ...s.future],
        lastSnapshotKey: undefined,
      });
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      commit({
        ...next,
        past: [...s.past, { nodes: s.nodes, edges: s.edges, params: s.params }],
        future: s.future.slice(1),
        lastSnapshotKey: undefined,
      });
    },

    onNodesChange: (changes) => {
      const meaningful = changes.some(
        (c) => c.type === "remove" || c.type === "add" || (c.type === "position" && !c.dragging),
      );
      if (changes.some((c) => c.type === "remove")) {
        get().beginChange();
        const removed = new Set(changes.flatMap((c) => (c.type === "remove" ? [c.id] : [])));
        set((s) => ({
          edges: s.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
        }));
      }
      const nodes = applyNodeChanges(changes, get().nodes);
      if (meaningful) commit({ nodes });
      else set({ nodes });
    },

    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === "remove")) {
        get().beginChange();
        commit({ edges: applyEdgeChanges(changes, get().edges) });
      } else {
        set({ edges: applyEdgeChanges(changes, get().edges) });
      }
    },

    checkConnection: (connection) => {
      const { nodes, index } = get();
      if (connection.source === connection.target) return { ok: false, reason: "不能连接到自身" };
      const src = nodes.find((n) => n.id === connection.source);
      const dst = nodes.find((n) => n.id === connection.target);
      const srcDef = src && resolveNodeDef(index, src.data);
      const dstDef = dst && resolveNodeDef(index, dst.data);
      const out = srcDef && findPort(srcDef, connection.sourceHandle, "out");
      const inp = dstDef && findPort(dstDef, connection.targetHandle, "in");
      if (!out || !inp) return { ok: false, reason: "找不到端口" };
      return checkCompatibility(out, inp);
    },

    connect: (connection) => {
      const result = get().checkConnection(connection);
      if (!result.ok) return result;
      const { nodes, edges, index } = get();
      const dst = nodes.find((n) => n.id === connection.target)!;
      const inp = findPort(resolveNodeDef(index, dst.data)!, connection.targetHandle, "in")!;

      get().beginChange();
      // Like ComfyUI, a single-value input keeps only its newest link.
      const kept = inp.collect
        ? edges
        : edges.filter(
            (e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle),
          );
      commit({ edges: addEdge({ ...connection, id: newId("e") }, kept) });
      return result;
    },

    addNode: (def, position) => {
      get().beginChange();
      const node = toFlowNode(
        createNode(def, position, get().nodes.map((n) => ({ id: n.id, position: n.position, data: n.data }))),
      );
      commit({
        nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }],
      });
      return node;
    },

    updateNodeData: (id, patch, historyKey) => {
      get().beginChange(historyKey ?? `node:${id}`);
      commit({
        nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      });
    },

    setWidget: (id, name, value) => {
      const node = get().nodes.find((n) => n.id === id);
      if (!node) return;
      get().updateNodeData(id, { widgets: { ...node.data.widgets, [name]: value } }, `widget:${id}:${name}`);
    },

    removeNodes: (ids) => {
      const drop = new Set(ids);
      get().beginChange();
      commit({
        nodes: get().nodes.filter((n) => !drop.has(n.id)),
        edges: get().edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
      });
    },

    setName: (name) => {
      get().beginChange("name");
      commit({ name });
    },

    setProject: (project) => {
      get().beginChange("project");
      commit({ project });
    },

    setParam: (key, value) => {
      get().beginChange(`param:${key}`);
      const params = { ...get().params };
      if (value === undefined || value === "") delete params[key];
      else params[key] = value;
      commit({ params });
    },
  };
});

export const selectIsDirty = (s: EditorState) => s.revision !== s.savedRevision;
export const selectSelectedNode = (s: EditorState) => {
  const selected = s.nodes.filter((n) => n.selected);
  return selected.length === 1 ? selected[0] : undefined;
};
