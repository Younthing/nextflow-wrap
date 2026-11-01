import { beforeEach, describe, expect, it } from "vitest";

import { createEditorStore, type EditorStore } from "@/features/editor/store";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import { EXAMPLE_FASTQ_QC_ID, EXAMPLE_MODULES, EXAMPLE_REPORT_ID, EXAMPLE_TRIM_ID } from "@/features/workflow/example-modules";
import { createEditorActions } from "./editor-actions";

let store: EditorStore;
let actions: ReturnType<typeof createEditorActions>;

beforeEach(() => {
  store = createEditorStore();
  actions = createEditorActions(store);
  store.getState().load(emptyWorkflow("wf", "测试"));
  store.getState().setIndex(indexModules(EXAMPLE_MODULES));
});

/** Builds samplesheet -> FASTQ_QC -> SUMMARY_REPORT the way the assistant would. */
function buildQc() {
  actions.addModule({ moduleId: "builtin/samplesheet" });
  actions.addModule({ moduleId: EXAMPLE_FASTQ_QC_ID, after: "SAMPLESHEET" });
  actions.addModule({ moduleId: EXAMPLE_REPORT_ID, after: "FASTQ_QC" });
  actions.connectNodes({ source: "SAMPLESHEET", target: "fastq_qc" });
  return actions.connectNodes({ source: "FASTQ_QC", sourcePort: "html", target: "SUMMARY_REPORT" });
}

describe("assistant editor actions", () => {
  it("finds modules with their ports", () => {
    const [first] = actions.searchCatalog("fastq_qc", 3);
    expect(first.moduleId).toBe(EXAMPLE_FASTQ_QC_ID);
    expect(first.inputs.map((p) => p.name)).toEqual(["reads"]);
    expect(first.outputs.map((p) => p.name)).toContain("html");
  });

  it("builds a connected workflow by alias", () => {
    expect(buildQc()).toMatchObject({ connected: "FASTQ_QC.html -> SUMMARY_REPORT.files" });
    const summary = actions.workflowSummary();
    expect(summary.nodes.map((n) => n.alias)).toEqual(["SAMPLESHEET", "FASTQ_QC", "SUMMARY_REPORT"]);
    expect(summary.edges).toEqual(["SAMPLESHEET.reads -> FASTQ_QC.reads", "FASTQ_QC.html -> SUMMARY_REPORT.files"]);
  });

  it("places new nodes to the right of the one they follow", () => {
    actions.addModule({ moduleId: "builtin/samplesheet" });
    const next = actions.addModule({ moduleId: EXAMPLE_FASTQ_QC_ID, after: "SAMPLESHEET" });
    const [a, b] = store.getState().nodes;
    expect(next.alias).toBe("FASTQ_QC");
    expect(b.position.x).toBeGreaterThan(a.position.x);
  });

  it("explains what went wrong so the model can retry", () => {
    expect(() => actions.addModule({ moduleId: "script/fastq_qcc/v1" })).toThrow(/script\/fastq_qc\/v1/);
    buildQc();
    expect(() => actions.connectNodes({ source: "FASTQ_QC", target: "SUMMARY_REPORT" })).toThrow(/多个输出端口（html, stats/);
    expect(() => actions.connectNodes({ source: "NOPE", target: "SUMMARY_REPORT" })).toThrow(/现有节点：SAMPLESHEET, FASTQ_QC, SUMMARY_REPORT/);
    expect(() => actions.configureNode({ node: "FASTQ_QC", widgets: { nope: 1 } })).toThrow(/没有参数 nope/);
  });

  it("leaves the canvas unchanged when a request is rejected", () => {
    buildQc();
    const before = store.getState().nodes;
    expect(() => actions.addModule({ moduleId: EXAMPLE_TRIM_ID, alias: "fastq_qc" })).toThrow(/已经被别的节点用了/);
    expect(() => actions.addModule({ moduleId: EXAMPLE_TRIM_ID, alias: "9bad" })).toThrow(/不合法/);
    expect(() => actions.configureNode({ node: "FASTQ_QC", config: { args: "--quiet" }, alias: "SUMMARY_REPORT" })).toThrow(/已经被别的节点用了/);
    expect(store.getState().nodes).toBe(before);
  });

  it("checks widget values against their declared type", () => {
    actions.addModule({ moduleId: EXAMPLE_TRIM_ID });
    expect(() => actions.configureNode({ node: "TRIM_READS", widgets: { min_length: "30" } })).toThrow(/integer 类型/);
    actions.configureNode({ node: "TRIM_READS", widgets: { min_length: 30 } });
    expect(actions.findNode("TRIM_READS").data.widgets.min_length).toBe(30);
  });

  it("configures nodes and params in undoable steps", () => {
    buildQc();
    actions.configureNode({ node: "FASTQ_QC", alias: "fastq_qc_raw", config: { args: "--quiet" } });
    const node = store.getState().nodes.find((n) => n.data.alias === "FASTQ_QC_RAW")!;
    expect(node.data.config).toEqual({ publish: true, args: "--quiet" });

    actions.setParam("outdir", "results");
    expect(store.getState().params.outdir).toBe("results");
    actions.setParam("outdir", null);
    expect(store.getState().params.outdir).toBeUndefined();

    store.getState().undo();
    expect(store.getState().params.outdir).toBe("results");
  });

  it("disconnects and removes nodes", () => {
    buildQc();
    expect(actions.disconnect({ source: "FASTQ_QC", target: "SUMMARY_REPORT" })).toEqual({ removed: 1 });
    expect(actions.removeNode("SUMMARY_REPORT")).toEqual({ removed: "SUMMARY_REPORT" });
    expect(actions.workflowSummary().edges).toEqual(["SAMPLESHEET.reads -> FASTQ_QC.reads"]);
  });

  it("reports validation issues in the summary", () => {
    actions.addModule({ moduleId: EXAMPLE_FASTQ_QC_ID });
    expect(actions.workflowSummary().issues).toContainEqual(expect.objectContaining({ level: "error", node: "FASTQ_QC" }));
  });
});
