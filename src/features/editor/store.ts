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
import { materializeClipboard, selectionClipboard, type NodeClipboard } from "./clipboard";
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
  name: string;
  project?: ProjectSettings;
}

const snapshotOf = (s: Snapshot): Snapshot => ({
  nodes: s.nodes,
  edges: s.edges,
  params: s.params,
  name: s.name,
  project: s.project,
});

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
  /** Bumped by every load, so async work can tell whether its document is still open. */
  generation: number;
  past: Snapshot[];
  future: Snapshot[];
  lastSnapshotKey?: string;
  /** In-memory node clipboard. Survives undo and loading another workflow. */
  clipboard: NodeClipboard | null;
  /** How many times the current clipboard has been pasted. The next paste steps further. */
  clipboardPastes: number;

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

  copySelected: () => void;
  pasteFromClipboard: () => void;
  duplicateSelected: () => void;
  selectAllNodes: () => void;
  clearSelection: () => void;
}

function toFlowNode(n: WorkflowDoc["nodes"][number]): FlowNode {
  return { id: n.id, type: "module", position: n.position, data: n.data };
}

function pastedNode(node: NodeClipboard["nodes"][number]): FlowNode {
  return { id: node.id, type: "module", position: node.position, data: node.data, selected: true };
}

function pastedEdge(edge: NodeClipboard["edges"][number]): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Applies a content change and bumps the revision. */
  const commit = (patch: Partial<EditorState>) =>
    set((s) => ({ ...patch, revision: s.revision + 1 }));

  const applyClipboard = (clip: NodeClipboard, step: number, extra?: Partial<EditorState>) => {
    const created = materializeClipboard(clip, get().nodes, get().index, step);
    get().beginChange();
    commit({
      nodes: [
        ...get().nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
        ...created.nodes.map(pastedNode),
      ],
      edges: [...get().edges, ...created.edges.map(pastedEdge)],
      params: { ...get().params, ...created.params },
      ...extra,
    });
  };

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
    generation: 0,
    past: [],
    future: [],
    clipboard: null,
    clipboardPastes: 0,

    setIndex: (index) => set({ index }),

    load: (doc) =>
      set((s) => ({
        generation: s.generation + 1,
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
      })),

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
      const snap = snapshotOf(s);
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
        future: [snapshotOf(s), ...s.future],
        lastSnapshotKey: undefined,
      });
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      commit({
        ...next,
        past: [...s.past, snapshotOf(s)],
        future: s.future.slice(1),
        lastSnapshotKey: undefined,
      });
    },

    copySelected: () => {
      const { nodes, edges, params } = get();
      const clip = selectionClipboard(nodes, edges, params);
      if (!clip) return;
      set({ clipboard: clip, clipboardPastes: 0 });
    },

    pasteFromClipboard: () => {
      const { clipboard, clipboardPastes } = get();
      if (!clipboard?.nodes.length) return;
      applyClipboard(clipboard, clipboardPastes + 1, { clipboardPastes: clipboardPastes + 1 });
    },

    duplicateSelected: () => {
      const { nodes, edges, params } = get();
      const clip = selectionClipboard(nodes, edges, params);
      if (!clip) return;
      applyClipboard(clip, 1);
    },

    selectAllNodes: () => {
      const nodes = get().nodes;
      if (nodes.length === 0 || nodes.every((node) => node.selected)) return;
      set({ nodes: nodes.map((node) => (node.selected ? node : { ...node, selected: true })) });
    },

    clearSelection: () => {
      const { nodes, edges } = get();
      if (!selectHasSelection({ nodes, edges })) return;
      set({
        nodes: nodes.some((node) => node.selected)
          ? nodes.map((node) => (node.selected ? { ...node, selected: false } : node))
          : nodes,
        edges: edges.some((edge) => edge.selected)
          ? edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
          : edges,
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

/** True when Escape should clear the canvas. Edges count, so a selected link is not left behind. */
export function selectHasSelection(state: {
  nodes: readonly { selected?: boolean }[];
  edges: readonly { selected?: boolean }[];
}): boolean {
  return state.nodes.some((node) => node.selected) || state.edges.some((edge) => edge.selected);
}

export const selectSelectedNode = (s: EditorState) => {
  const selected = s.nodes.filter((n) => n.selected);
  return selected.length === 1 ? selected[0] : undefined;
};
