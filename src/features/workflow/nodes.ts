import { REFERENCE_ID } from "./builtins";
import { operatorDefaults } from "./operators";
import { widgetInputs } from "./ports";
import type { ModuleDef, WidgetValue, WorkflowNode } from "./types";

export function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** First free alias: FASTQC, FASTQC_2, FASTQC_3, … */
export function uniqueAlias(base: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

function defaultWidgetValue(type: string): WidgetValue {
  switch (type) {
    case "boolean":
      return false;
    case "integer":
    case "float":
    case "number":
      return 0;
    default:
      return "";
  }
}

export function createNode(
  def: ModuleDef,
  position: { x: number; y: number },
  existing: WorkflowNode[],
): WorkflowNode {
  const widgets = Object.fromEntries(
    widgetInputs(def).map((p) => [p.name, defaultWidgetValue(p.widget!)]),
  );
  const alias = uniqueAlias(
    def.process,
    existing.map((n) => n.data.alias),
  );
  return {
    id: newId("n"),
    position,
    data: {
      moduleId: def.id,
      alias,
      widgets,
      config: def.builtin ? {} : { publish: true },
      settings:
        def.id === REFERENCE_ID
          ? {
              param: uniqueAlias(
                "fasta",
                existing.map((n) => String(n.data.settings?.param ?? "")),
              ),
              format: "fasta",
            }
          : operatorDefaults(def.id),
    },
  };
}
