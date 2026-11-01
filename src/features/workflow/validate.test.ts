import { describe, expect, it } from "vitest";

import { SAMPLESHEET_ID } from "./builtins";
import { indexModules } from "./catalog";
import { demoWorkflow, dockingWorkflow } from "./demo";
import { EXAMPLE_MODULES, EXAMPLE_TRIM_ID } from "./example-modules";
import type { ModuleDef, WorkflowNode } from "./types";
import { validateWorkflow } from "./validate";

const index = indexModules(EXAMPLE_MODULES);
const node = (id: string, moduleId: string, alias: string): WorkflowNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { moduleId, alias, widgets: {}, config: {} },
});

describe("validateWorkflow", () => {
  it("accepts the demo workflow", () => {
    const doc = demoWorkflow("wf");
    expect(validateWorkflow(doc.nodes, doc.edges, doc.params, index)).toEqual([]);
  });

  it("accepts the docking example", () => {
    const doc = dockingWorkflow("dock");
    expect(validateWorkflow(doc.nodes, doc.edges, doc.params, index)).toEqual([]);
  });

  it("reports a missing main input and duplicate aliases", () => {
    const doc = demoWorkflow("wf");
    const edges = doc.edges.filter((e) => e.target !== "cluster");
    const nodes = doc.nodes.map((n) => (n.id === "report" ? { ...n, data: { ...n.data, alias: "SCANPY_QC" } } : n));
    const messages = validateWorkflow(nodes, edges, doc.params, index).map((i) => i.message);
    expect(messages).toContain("SCANPY_CLUSTER：主输入 adata 未连接");
    expect(messages).toContain("别名 SCANPY_QC 重复了 2 次");
  });

  it("requires --input for the samplesheet", () => {
    const nodes = [node("input", SAMPLESHEET_ID, "SAMPLESHEET")];
    const issues = validateWorkflow(nodes, [], { input: "", outdir: "results" }, index);
    expect(issues.some((i) => i.level === "error" && i.message.includes("--input"))).toBe(true);
  });
});

describe("validateWorkflow padded inputs", () => {
  const nodes = [node("input", SAMPLESHEET_ID, "SAMPLESHEET"), node("trim", EXAMPLE_TRIM_ID, "TRIM_READS")];
  const edges = [{ id: "e", source: "input", sourceHandle: "out:reads", target: "trim", targetHandle: "in:reads" }];
  const params = { input: "samples.csv", outdir: "results" };

  it("accepts a padded file described as optional", () => {
    expect(validateWorkflow(nodes, edges, params, index).filter((i) => i.nodeId === "trim")).toEqual([]);
  });

  it("warns when a link leaves a required-looking tuple file empty", () => {
    const strict: ModuleDef = {
      ...EXAMPLE_MODULES.find((m) => m.id === EXAMPLE_TRIM_ID)!,
      inputs: EXAMPLE_MODULES.find((m) => m.id === EXAMPLE_TRIM_ID)!.inputs.map((port) => ({
        ...port,
        elements: port.elements.map((el) => (el.name === "adapters" ? { ...el, description: "接头序列" } : el)),
      })),
    };
    const issues = validateWorkflow(nodes, edges, params, indexModules([strict]));
    expect(issues.some((i) => i.nodeId === "trim" && i.message.includes("adapters"))).toBe(true);
  });
});
