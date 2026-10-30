import { REFERENCE_ID, SAMPLESHEET_ID } from "./builtins";
import { resolveNodeDef, type ModuleIndex } from "./catalog";
import { socketInputs } from "./ports";
import type { PipelineParams, WorkflowEdge, WorkflowNode } from "./types";

export interface Issue {
  nodeId?: string;
  level: "error" | "warning";
  message: string;
}

const ALIAS_RE = /^[A-Z][A-Z0-9_]*$/;
const PARAM_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Checks that matter before a workflow can be turned into a runnable
 * project. The first socket of a module is its main data input, so it must
 * be linked; later sockets are often optional and only warn.
 */
export function validateWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  params: PipelineParams,
  index: ModuleIndex,
): Issue[] {
  const issues: Issue[] = [];
  const aliases = new Map<string, number>();
  const paramNames = new Map<string, number>();

  for (const node of nodes) {
    const { data } = node;
    aliases.set(data.alias, (aliases.get(data.alias) ?? 0) + 1);
    const def = resolveNodeDef(index, data);
    if (!def) {
      issues.push({ nodeId: node.id, level: "error", message: `未知模块 ${data.moduleId}` });
      continue;
    }
    if (!ALIAS_RE.test(data.alias)) {
      issues.push({ nodeId: node.id, level: "error", message: `${data.alias}：别名只能用大写字母、数字和下划线` });
    }
    if (data.disabled) continue;

    if (def.id === SAMPLESHEET_ID && !params.input) {
      issues.push({ nodeId: node.id, level: "error", message: "样本表节点需要设置流程参数 --input" });
    }
    if (def.id === REFERENCE_ID) {
      const param = String(data.settings?.param ?? "");
      if (!PARAM_RE.test(param)) {
        issues.push({ nodeId: node.id, level: "error", message: `${data.alias}：参数名 "${param}" 无效` });
      } else {
        paramNames.set(param, (paramNames.get(param) ?? 0) + 1);
        if (!params[param]) {
          issues.push({ nodeId: node.id, level: "warning", message: `参数 --${param} 还没有设置路径` });
        }
      }
    }

    const linked = new Set(edges.filter((e) => e.target === node.id).map((e) => e.targetHandle));
    socketInputs(def).forEach((port, i) => {
      if (linked.has(`in:${port.name}`)) return;
      issues.push({
        nodeId: node.id,
        level: i === 0 ? "error" : "warning",
        message:
          i === 0
            ? `${data.alias}：主输入 ${port.name} 未连接`
            : `${data.alias}：输入 ${port.name} 未连接，将传入空值 []`,
      });
    });
  }

  for (const [alias, count] of aliases) {
    if (count > 1) issues.push({ level: "error", message: `别名 ${alias} 重复了 ${count} 次` });
  }
  for (const [param, count] of paramNames) {
    if (count > 1) issues.push({ level: "error", message: `参数 --${param} 被 ${count} 个参考文件节点使用` });
  }
  return issues;
}
