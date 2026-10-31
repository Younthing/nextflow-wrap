import { describe, expect, it } from "vitest";

import { keepLocalWorkflowEdits, workflowWriteIsStale } from "./revision";

describe("workflowWriteIsStale", () => {
  it("accepts the first write and a retry of the current revision", () => {
    expect(workflowWriteIsStale(undefined, { updatedAt: "t0" })).toBe(false);
    expect(workflowWriteIsStale({ updatedAt: "t0" }, { updatedAt: "t0" })).toBe(false);
  });

  it("rejects a write that still carries an older revision", () => {
    expect(workflowWriteIsStale({ updatedAt: "t1" }, { updatedAt: "t0" })).toBe(true);
  });
});

describe("keepLocalWorkflowEdits", () => {
  const server = { id: "wf", updatedAt: "t1" };

  it("keeps unsaved edits made on the revision the server still has", () => {
    expect(keepLocalWorkflowEdits({ docId: "wf", updatedAt: "t1", dirty: true }, server)).toBe(true);
  });

  it("drops a dirty editor once the server revision moved", () => {
    expect(keepLocalWorkflowEdits({ docId: "wf", updatedAt: "t0", dirty: true }, server)).toBe(false);
    expect(keepLocalWorkflowEdits({ docId: "wf", updatedAt: "t1", dirty: false }, server)).toBe(false);
    expect(keepLocalWorkflowEdits({ docId: "other", updatedAt: "t0", dirty: true }, server)).toBe(false);
  });
});
