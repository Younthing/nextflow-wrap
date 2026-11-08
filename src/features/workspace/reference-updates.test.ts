import { describe, expect, it } from "vitest";
import { emptyWorkflow } from "@/features/workflow/document";
import { FILE_ID, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { planReferenceUpdates } from "./reference-updates";

describe("file reference update preview", () => {
  it("updates declared inputs while preserving ordinary strings and expressions", () => {
    const workflow = emptyWorkflow("flow");
    workflow.params = { input: "data/samples.csv", title: "data/samples.csv" };
    workflow.nodes = [
      { id: "file", position: { x: 0, y: 0 }, data: { moduleId: FILE_ID, alias: "READS", widgets: {}, config: {}, settings: { path: "./data/reads.fq" } } },
      { id: "sheet", position: { x: 0, y: 100 }, data: { moduleId: SAMPLESHEET_ID, alias: "SHEET", widgets: {}, config: {} } },
    ];
    const [plan] = planReferenceUpdates([workflow], [{ from: "data", to: "inputs" }]);
    expect(plan.document.params.input).toBe("inputs/samples.csv");
    expect(plan.document.params.title).toBe("data/samples.csv");
    expect(plan.document.nodes[0].data.settings?.path).toBe("inputs/reads.fq");
    expect(workflow.nodes[0].data.settings?.path).toBe("./data/reads.fq");
    expect(plan.changes).toHaveLength(2);
  });

  it("does not rewrite external paths or unchanged moves", () => {
    const workflow = emptyWorkflow("flow");
    workflow.nodes = [{ id: "file", position: { x: 0, y: 0 }, data: { moduleId: FILE_ID, alias: "READS", widgets: {}, config: {}, settings: { path: "/shared/data/reads.fq" } } }];
    expect(planReferenceUpdates([workflow], [{ from: "data", to: "inputs" }])).toEqual([]);
    workflow.nodes[0].data.settings!.path = "data/reads.fq";
    expect(planReferenceUpdates([workflow], [{ from: "data", to: "data" }])).toEqual([]);
  });
});
