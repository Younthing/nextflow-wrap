import type { WorkflowDoc } from "./types";

export const WORKFLOW_FILE_VERSION = 1;

export function emptyWorkflow(id: string, name = "未命名流程"): WorkflowDoc {
  return {
    id,
    name,
    version: WORKFLOW_FILE_VERSION,
    nodes: [],
    edges: [],
    params: { input: "assets/samplesheet.csv", outdir: "results" },
    updatedAt: new Date().toISOString(),
  };
}

/** Narrow an unknown JSON value (e.g. an imported file) to a workflow doc. */
export function parseWorkflowDoc(value: unknown): WorkflowDoc {
  if (!value || typeof value !== "object") throw new Error("不是有效的流程文件");
  const doc = value as Partial<WorkflowDoc>;
  if (doc.version !== WORKFLOW_FILE_VERSION) throw new Error(`不支持的流程文件版本：${String(doc.version)}`);
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error("流程文件缺少 nodes 或 edges");
  for (const n of doc.nodes) {
    if (!n?.id || !n.data?.moduleId || !n.data.alias) throw new Error("流程文件里有无效的节点");
  }
  for (const e of doc.edges) {
    if (!e?.id || !e.source || !e.target || !e.sourceHandle || !e.targetHandle) {
      throw new Error("流程文件里有无效的连线");
    }
  }
  return {
    id: doc.id ?? "",
    name: doc.name ?? "导入的流程",
    description: doc.description,
    project: doc.project,
    version: WORKFLOW_FILE_VERSION,
    // Fill fields older or hand-written files may lack, so the canvas can always render them.
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      position: {
        x: Number.isFinite(n.position?.x) ? n.position.x : 0,
        y: Number.isFinite(n.position?.y) ? n.position.y : 0,
      },
      data: { ...n.data, widgets: n.data.widgets ?? {}, config: n.data.config ?? {} },
    })),
    edges: doc.edges,
    params: doc.params ?? {},
    updatedAt: doc.updatedAt ?? new Date().toISOString(),
  };
}
