import { describe, expect, it } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { indexModules } from "./catalog";
import { demoRnaseqWorkflow } from "./demo";
import type { ModuleCatalog } from "./types";
import { validateWorkflow } from "./validate";

const index = indexModules((catalog as ModuleCatalog).modules);

describe("validateWorkflow", () => {
  it("accepts the demo workflow", () => {
    const doc = demoRnaseqWorkflow("wf");
    expect(validateWorkflow(doc.nodes, doc.edges, doc.params, index)).toEqual([]);
  });

  it("reports a missing main input and duplicate aliases", () => {
    const doc = demoRnaseqWorkflow("wf");
    const edges = doc.edges.filter((e) => e.target !== "fastqc");
    const nodes = doc.nodes.map((n) => (n.id === "star" ? { ...n, data: { ...n.data, alias: "FASTP" } } : n));
    const messages = validateWorkflow(nodes, edges, doc.params, index).map((i) => i.message);
    expect(messages).toContain("FASTQC：主输入 reads 未连接");
    expect(messages).toContain("别名 FASTP 重复了 2 次");
  });

  it("requires --input for the samplesheet", () => {
    const doc = demoRnaseqWorkflow("wf");
    const issues = validateWorkflow(doc.nodes, doc.edges, { ...doc.params, input: "" }, index);
    expect(issues.some((i) => i.level === "error" && i.message.includes("--input"))).toBe(true);
  });
});
