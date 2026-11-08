import { dataPathParams } from "@/features/runs/data-params";
import { isInputNode } from "@/features/workflow/builtins";
import type { WorkflowDoc } from "@/features/workflow/types";
import { normalizeWorkspacePath } from "./paths";

export interface FileMove { from: string; to: string }
export interface ReferenceUpdate {
  document: WorkflowDoc;
  changes: { field: string; before: string; after: string }[];
}

/** Update only declared file inputs. Code, expressions and ordinary string widgets are never rewritten. */
export function planReferenceUpdates(workflows: WorkflowDoc[], moves: FileMove[]): ReferenceUpdate[] {
  return workflows.flatMap((original) => {
    const document = structuredClone(original);
    const changes: ReferenceUpdate["changes"] = [];
    const replace = (field: string, value: unknown) => {
      if (typeof value !== "string" || value.includes("${")) return value;
      const path = normalizeWorkspacePath(value);
      if (!path || path.startsWith("..")) return value;
      const move = moves.find(({ from }) => path === from || path.startsWith(`${from}/`));
      if (!move) return value;
      const after = `${move.to}${path.slice(move.from.length)}`;
      if (after === value) return value;
      changes.push({ field, before: value, after });
      return after;
    };
    for (const name of dataPathParams(document)) {
      const value = document.params[name];
      if (typeof value === "string") document.params[name] = replace(`params.${name}`, value) as string;
    }
    for (const node of document.nodes) {
      if (!isInputNode(node.data.moduleId) || !node.data.settings) continue;
      node.data.settings.path = replace(`${node.data.alias}.path`, node.data.settings.path) as string;
    }
    return changes.length ? [{ document, changes }] : [];
  });
}
