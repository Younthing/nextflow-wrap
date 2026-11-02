import { FILE_ID, FOLDER_ID, formatFromPath, isInputNode } from "./builtins";
import type { PipelineParams, WorkflowDoc } from "./types";

/** The pipeline param a file or folder input node becomes: `COUNTS` → `counts`. */
export const inputParamName = (alias: string) => alias.toLowerCase();

export interface InputParam {
  name: string;
  kind: "file" | "folder";
  /** Chosen path; empty when the node has none yet. */
  path: string;
  /** File format from the extension, `dir` for a folder. */
  format?: string;
  optional: boolean;
  nodeAlias: string;
}

/** File and folder input nodes on the canvas, as pipeline params. */
export function inputParams(doc: Pick<WorkflowDoc, "nodes">): InputParam[] {
  const out: InputParam[] = [];
  for (const node of doc.nodes) {
    if (!isInputNode(node.data.moduleId) || node.data.disabled) continue;
    const path = String(node.data.settings?.path ?? "").trim();
    const kind = node.data.moduleId === FOLDER_ID ? "folder" : "file";
    out.push({
      name: inputParamName(node.data.alias),
      kind,
      path,
      format: node.data.moduleId === FILE_ID ? formatFromPath(path) : "dir",
      optional: node.data.settings?.optional === true,
      nodeAlias: node.data.alias,
    });
  }
  return out;
}

/** The params a run is launched with: the workflow's own params plus the paths chosen on input nodes. */
export function launchParams(doc: Pick<WorkflowDoc, "nodes" | "params">): PipelineParams {
  const params: PipelineParams = { ...doc.params };
  for (const input of inputParams(doc)) {
    if (input.path) params[input.name] = input.path;
  }
  return params;
}
