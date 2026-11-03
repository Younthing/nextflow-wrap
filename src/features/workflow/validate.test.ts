import { describe, expect, it } from "vitest";

import { FILE_ID, FOLDER_ID, SAMPLESHEET_ID } from "./builtins";
import { indexModules } from "./catalog";
import { fixtureWorkflow, fixtureDockingWorkflow } from "./fixture-workflows";
import { FIXTURE_MODULES, FIXTURE_TRIM_ID } from "./fixture-modules";
import type { ModuleDef, WorkflowNode } from "./types";
import { validateWorkflow } from "./validate";

const index = indexModules(FIXTURE_MODULES);
const node = (id: string, moduleId: string, alias: string): WorkflowNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { moduleId, alias, widgets: {}, config: {} },
});

describe("validateWorkflow", () => {
  it("accepts the demo workflow", () => {
    const doc = fixtureWorkflow("wf");
    expect(validateWorkflow(doc.nodes, doc.edges, doc.params, index)).toEqual([]);
  });

  it("accepts the docking example", () => {
    const doc = fixtureDockingWorkflow("dock");
    expect(validateWorkflow(doc.nodes, doc.edges, doc.params, index)).toEqual([]);
  });

  it("reports a missing main input and duplicate aliases", () => {
    const doc = fixtureWorkflow("wf");
    const edges = doc.edges.filter((e) => e.target !== "cluster");
    const nodes = doc.nodes.map((n) => (n.id === "report" ? { ...n, data: { ...n.data, alias: "SCANPY_QC" } } : n));
    const messages = validateWorkflow(nodes, edges, doc.params, index).map((i) => i.message);
    expect(messages).toContain("SCANPY_CLUSTER：主输入 adata 未连接");
    expect(messages).toContain("别名 SCANPY_QC 重复了 2 次");
  });

  it("requires a path on file and folder inputs unless they are optional", () => {
    const withSettings = (n: WorkflowNode, settings: Record<string, string | boolean>) => ({ ...n, data: { ...n.data, settings } });
    const nodes = [
      node("f", FILE_ID, "COUNTS"),
      node("d", FOLDER_ID, "MATRIX"),
      withSettings(node("o", FILE_ID, "EXTRA"), { optional: true }),
      withSettings(node("ok", FILE_ID, "LIGANDS"), { path: "/data/ligands.csv" }),
    ];
    const messages = validateWorkflow(nodes, [], { outdir: "results" }, index).map((i) => i.message);
    expect(messages).toEqual(["COUNTS：还没有选择文件", "MATRIX：还没有选择文件夹"]);
  });

  it("rejects an input alias that would shadow a built-in param", () => {
    const nodes = [{ ...node("f", FILE_ID, "OUTDIR"), data: { ...node("f", FILE_ID, "OUTDIR").data, settings: { path: "/x.csv" } } }];
    const messages = validateWorkflow(nodes, [], { outdir: "results" }, index).map((i) => i.message);
    expect(messages[0]).toContain("--outdir");
  });

  it("requires --input for the samplesheet", () => {
    const nodes = [node("input", SAMPLESHEET_ID, "SAMPLESHEET")];
    const issues = validateWorkflow(nodes, [], { input: "", outdir: "results" }, index);
    expect(issues.some((i) => i.level === "error" && i.message.includes("--input"))).toBe(true);
  });
});

describe("validateWorkflow padded inputs", () => {
  const nodes = [node("input", SAMPLESHEET_ID, "SAMPLESHEET"), node("trim", FIXTURE_TRIM_ID, "TRIM_READS")];
  const edges = [{ id: "e", source: "input", sourceHandle: "out:reads", target: "trim", targetHandle: "in:reads" }];
  const params = { input: "samples.csv", outdir: "results" };

  it("accepts a padded file described as optional", () => {
    expect(validateWorkflow(nodes, edges, params, index).filter((i) => i.nodeId === "trim")).toEqual([]);
  });

  it("warns when a link leaves a required-looking tuple file empty", () => {
    const strict: ModuleDef = {
      ...FIXTURE_MODULES.find((m) => m.id === FIXTURE_TRIM_ID)!,
      inputs: FIXTURE_MODULES.find((m) => m.id === FIXTURE_TRIM_ID)!.inputs.map((port) => ({
        ...port,
        elements: port.elements.map((el) => (el.name === "adapters" ? { ...el, description: "接头序列" } : el)),
      })),
    };
    const issues = validateWorkflow(nodes, edges, params, indexModules([strict]));
    expect(issues.some((i) => i.nodeId === "trim" && i.message.includes("adapters"))).toBe(true);
  });
});
