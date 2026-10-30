import { describe, expect, it } from "vitest";

import { parseWorkflowDoc } from "./document";

describe("parseWorkflowDoc", () => {
  it("fills node fields missing from hand-written files", () => {
    const doc = parseWorkflowDoc({
      version: 1,
      nodes: [{ id: "n1", data: { moduleId: "nf-core/fastqc", alias: "FASTQC" } }],
      edges: [],
    });
    expect(doc.nodes[0].data.config).toEqual({});
    expect(doc.nodes[0].data.widgets).toEqual({});
    expect(doc.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("rejects other file versions", () => {
    expect(() => parseWorkflowDoc({ version: 2, nodes: [], edges: [] })).toThrow(/版本/);
  });
});
