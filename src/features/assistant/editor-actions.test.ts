import { beforeEach, describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { useEditorStore } from "@/features/editor/store";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import type { ModuleCatalog } from "@/features/workflow/types";
import {
  addModule,
  configureNode,
  connectNodes,
  disconnect,
  findNode,
  removeNode,
  searchCatalog,
  setParam,
  workflowSummary,
} from "./editor-actions";

beforeEach(() => {
  useEditorStore.getState().load(emptyWorkflow("wf", "测试"));
  useEditorStore.getState().setIndex(indexModules((catalog as ModuleCatalog).modules));
});

/** Builds samplesheet -> FASTQC -> MULTIQC the way the assistant would. */
function buildQc() {
  addModule({ moduleId: "builtin/samplesheet" });
  addModule({ moduleId: "nf-core/fastqc", after: "SAMPLESHEET" });
  addModule({ moduleId: "nf-core/multiqc", after: "FASTQC" });
  connectNodes({ source: "SAMPLESHEET", target: "fastqc" });
  return connectNodes({ source: "FASTQC", sourcePort: "zip", target: "MULTIQC" });
}

describe("assistant editor actions", () => {
  it("finds modules with their ports", () => {
    const [first] = searchCatalog("fastqc", 3);
    expect(first.moduleId).toBe("nf-core/fastqc");
    expect(first.inputs.map((p) => p.name)).toEqual(["reads"]);
    expect(first.outputs.map((p) => p.name)).toContain("zip");
  });

  it("builds a connected workflow by alias", () => {
    expect(buildQc()).toMatchObject({ connected: "FASTQC.zip -> MULTIQC.multiqc_files" });
    const summary = workflowSummary();
    expect(summary.nodes.map((n) => n.alias)).toEqual(["SAMPLESHEET", "FASTQC", "MULTIQC"]);
    expect(summary.edges).toEqual(["SAMPLESHEET.reads -> FASTQC.reads", "FASTQC.zip -> MULTIQC.multiqc_files"]);
  });

  it("places new nodes to the right of the one they follow", () => {
    addModule({ moduleId: "builtin/samplesheet" });
    const next = addModule({ moduleId: "nf-core/fastqc", after: "SAMPLESHEET" });
    const [a, b] = useEditorStore.getState().nodes;
    expect(next.alias).toBe("FASTQC");
    expect(b.position.x).toBeGreaterThan(a.position.x);
  });

  it("explains what went wrong so the model can retry", () => {
    expect(() => addModule({ moduleId: "nf-core/fastqcc" })).toThrow(/nf-core\/fastqc/);
    buildQc();
    expect(() => connectNodes({ source: "FASTQC", target: "MULTIQC" })).toThrow(/多个输出端口（html, zip/);
    expect(() => connectNodes({ source: "NOPE", target: "MULTIQC" })).toThrow(/现有节点：SAMPLESHEET, FASTQC, MULTIQC/);
    expect(() => configureNode({ node: "FASTQC", widgets: { nope: 1 } })).toThrow(/没有参数 nope/);
  });

  it("leaves the canvas unchanged when a request is rejected", () => {
    buildQc();
    const before = useEditorStore.getState().nodes;
    expect(() => addModule({ moduleId: "nf-core/fastp", alias: "fastqc" })).toThrow(/已经被别的节点用了/);
    expect(() => addModule({ moduleId: "nf-core/fastp", alias: "9bad" })).toThrow(/不合法/);
    expect(() => configureNode({ node: "FASTQC", config: { args: "--quiet" }, alias: "MULTIQC" })).toThrow(/已经被别的节点用了/);
    expect(useEditorStore.getState().nodes).toBe(before);
  });

  it("checks widget values against their declared type", () => {
    addModule({ moduleId: "nf-core/fastp" });
    expect(() => configureNode({ node: "FASTP", widgets: { discard_trimmed_pass: "false" } })).toThrow(/boolean 类型/);
    configureNode({ node: "FASTP", widgets: { discard_trimmed_pass: true } });
    expect(findNode("FASTP").data.widgets.discard_trimmed_pass).toBe(true);
  });

  it("configures nodes and params in undoable steps", () => {
    buildQc();
    configureNode({ node: "FASTQC", alias: "fastqc_raw", config: { args: "--quiet" } });
    const node = useEditorStore.getState().nodes.find((n) => n.data.alias === "FASTQC_RAW")!;
    expect(node.data.config).toEqual({ publish: true, args: "--quiet" });

    setParam("outdir", "results");
    expect(useEditorStore.getState().params.outdir).toBe("results");
    setParam("outdir", null);
    expect(useEditorStore.getState().params.outdir).toBeUndefined();

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().params.outdir).toBe("results");
  });

  it("disconnects and removes nodes", () => {
    buildQc();
    expect(disconnect({ source: "FASTQC", target: "MULTIQC" })).toEqual({ removed: 1 });
    expect(removeNode("MULTIQC")).toEqual({ removed: "MULTIQC" });
    expect(workflowSummary().edges).toEqual(["SAMPLESHEET.reads -> FASTQC.reads"]);
  });

  it("reports validation issues in the summary", () => {
    addModule({ moduleId: "nf-core/fastqc" });
    expect(workflowSummary().issues).toContainEqual(expect.objectContaining({ level: "error", node: "FASTQC" }));
  });
});
