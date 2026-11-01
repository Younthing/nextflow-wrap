import { beforeEach, describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { createEditorStore, type EditorStore } from "@/features/editor/store";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import type { ModuleCatalog } from "@/features/workflow/types";
import { createEditorActions } from "./editor-actions";

let store: EditorStore;
let actions: ReturnType<typeof createEditorActions>;

beforeEach(() => {
  store = createEditorStore();
  actions = createEditorActions(store);
  store.getState().load(emptyWorkflow("wf", "测试"));
  store.getState().setIndex(indexModules((catalog as ModuleCatalog).modules));
});

/** Builds samplesheet -> FASTQC -> MULTIQC the way the assistant would. */
function buildQc() {
  actions.addModule({ moduleId: "builtin/samplesheet" });
  actions.addModule({ moduleId: "nf-core/fastqc", after: "SAMPLESHEET" });
  actions.addModule({ moduleId: "nf-core/multiqc", after: "FASTQC" });
  actions.connectNodes({ source: "SAMPLESHEET", target: "fastqc" });
  return actions.connectNodes({ source: "FASTQC", sourcePort: "zip", target: "MULTIQC" });
}

describe("assistant editor actions", () => {
  it("finds modules with their ports", () => {
    const [first] = actions.searchCatalog("fastqc", 3);
    expect(first.moduleId).toBe("nf-core/fastqc");
    expect(first.inputs.map((p) => p.name)).toEqual(["reads"]);
    expect(first.outputs.map((p) => p.name)).toContain("zip");
  });

  it("builds a connected workflow by alias", () => {
    expect(buildQc()).toMatchObject({ connected: "FASTQC.zip -> MULTIQC.multiqc_files" });
    const summary = actions.workflowSummary();
    expect(summary.nodes.map((n) => n.alias)).toEqual(["SAMPLESHEET", "FASTQC", "MULTIQC"]);
    expect(summary.edges).toEqual(["SAMPLESHEET.reads -> FASTQC.reads", "FASTQC.zip -> MULTIQC.multiqc_files"]);
  });

  it("places new nodes to the right of the one they follow", () => {
    actions.addModule({ moduleId: "builtin/samplesheet" });
    const next = actions.addModule({ moduleId: "nf-core/fastqc", after: "SAMPLESHEET" });
    const [a, b] = store.getState().nodes;
    expect(next.alias).toBe("FASTQC");
    expect(b.position.x).toBeGreaterThan(a.position.x);
  });

  it("explains what went wrong so the model can retry", () => {
    expect(() => actions.addModule({ moduleId: "nf-core/fastqcc" })).toThrow(/nf-core\/fastqc/);
    buildQc();
    expect(() => actions.connectNodes({ source: "FASTQC", target: "MULTIQC" })).toThrow(/多个输出端口（html, zip/);
    expect(() => actions.connectNodes({ source: "NOPE", target: "MULTIQC" })).toThrow(/现有节点：SAMPLESHEET, FASTQC, MULTIQC/);
    expect(() => actions.configureNode({ node: "FASTQC", widgets: { nope: 1 } })).toThrow(/没有参数 nope/);
  });

  it("leaves the canvas unchanged when a request is rejected", () => {
    buildQc();
    const before = store.getState().nodes;
    expect(() => actions.addModule({ moduleId: "nf-core/fastp", alias: "fastqc" })).toThrow(/已经被别的节点用了/);
    expect(() => actions.addModule({ moduleId: "nf-core/fastp", alias: "9bad" })).toThrow(/不合法/);
    expect(() => actions.configureNode({ node: "FASTQC", config: { args: "--quiet" }, alias: "MULTIQC" })).toThrow(/已经被别的节点用了/);
    expect(store.getState().nodes).toBe(before);
  });

  it("checks widget values against their declared type", () => {
    actions.addModule({ moduleId: "nf-core/fastp" });
    expect(() => actions.configureNode({ node: "FASTP", widgets: { discard_trimmed_pass: "false" } })).toThrow(/boolean 类型/);
    actions.configureNode({ node: "FASTP", widgets: { discard_trimmed_pass: true } });
    expect(actions.findNode("FASTP").data.widgets.discard_trimmed_pass).toBe(true);
  });

  it("configures nodes and params in undoable steps", () => {
    buildQc();
    actions.configureNode({ node: "FASTQC", alias: "fastqc_raw", config: { args: "--quiet" } });
    const node = store.getState().nodes.find((n) => n.data.alias === "FASTQC_RAW")!;
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
    expect(actions.disconnect({ source: "FASTQC", target: "MULTIQC" })).toEqual({ removed: 1 });
    expect(actions.removeNode("MULTIQC")).toEqual({ removed: "MULTIQC" });
    expect(actions.workflowSummary().edges).toEqual(["SAMPLESHEET.reads -> FASTQC.reads"]);
  });

  it("reports validation issues in the summary", () => {
    actions.addModule({ moduleId: "nf-core/fastqc" });
    expect(actions.workflowSummary().issues).toContainEqual(expect.objectContaining({ level: "error", node: "FASTQC" }));
  });
});
