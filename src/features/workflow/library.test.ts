import { describe, expect, it } from "vitest";

import { duplicateWorkflowName, filterWorkflows, latestRunByWorkflow, WORKFLOW_NAME_MAX } from "./library";

const workflows = [
  { id: "a", name: "RNA-seq", description: "fastp 修剪" },
  { id: "b", name: "质控", description: "FastQC" },
];

describe("filterWorkflows", () => {
  it("returns every workflow when the query is blank", () => {
    expect(filterWorkflows(workflows, "  ")).toEqual(workflows);
  });

  it("matches name or description, ignoring case", () => {
    expect(filterWorkflows(workflows, "rna")).toEqual([workflows[0]]);
    expect(filterWorkflows(workflows, "fastqc")).toEqual([workflows[1]]);
    expect(filterWorkflows(workflows, "missing")).toEqual([]);
  });
});

describe("latestRunByWorkflow", () => {
  it("keeps the newest submitted run for each workflow", () => {
    const runs = [
      { id: "old", workflowId: "a", submittedAt: "2020-01-01T00:00:00.000Z" },
      { id: "new", workflowId: "a", submittedAt: "2024-01-01T00:00:00.000Z" },
      { id: "b1", workflowId: "b", submittedAt: "2023-01-01T00:00:00.000Z" },
    ];
    const latest = latestRunByWorkflow(runs);
    expect(latest.get("a")?.id).toBe("new");
    expect(latest.get("b")?.id).toBe("b1");
  });

  it("keeps the first run when timestamps tie", () => {
    const runs = [
      { id: "first", workflowId: "a", submittedAt: "2024-01-01T00:00:00.000Z" },
      { id: "second", workflowId: "a", submittedAt: "2024-01-01T00:00:00.000Z" },
    ];
    expect(latestRunByWorkflow(runs).get("a")?.id).toBe("first");
  });
});

describe("duplicateWorkflowName", () => {
  it("appends 副本 and falls back when the name is blank", () => {
    expect(duplicateWorkflowName("RNA-seq")).toBe("RNA-seq 副本");
    expect(duplicateWorkflowName("  ")).toBe("未命名流程 副本");
  });

  it("stays within the API name limit", () => {
    const copy = duplicateWorkflowName("a".repeat(WORKFLOW_NAME_MAX));
    expect(copy).toHaveLength(WORKFLOW_NAME_MAX);
    expect(copy.endsWith(" 副本")).toBe(true);
  });
});
