import { describe, expect, it } from "vitest";

import { emptyWorkflow } from "./document";
import { commitWorkflowPut, keepLocalWorkflowEdits, workflowWriteIsStale } from "./revision";

describe("workflowWriteIsStale", () => {
  it("accepts the first write and a retry of the current revision", () => {
    expect(workflowWriteIsStale(undefined, { updatedAt: "t0" })).toBe(false);
    expect(workflowWriteIsStale({ updatedAt: "t0" }, { updatedAt: "t0" })).toBe(false);
  });

  it("rejects a write that still carries an older revision", () => {
    expect(workflowWriteIsStale({ updatedAt: "t1" }, { updatedAt: "t0" })).toBe(true);
  });
});

describe("commitWorkflowPut", () => {
  it("writes only when the stored revision is still the one the client read", () => {
    const current = emptyWorkflow("wf", "原名");
    current.updatedAt = "t0";
    const stale = commitWorkflowPut(current, { ...current, name: "late", updatedAt: "t0-old" }, "t1");
    expect(stale.status).toBe("stale");
    const ok = commitWorkflowPut(current, { ...current, name: "新名", updatedAt: "t0" }, "t1");
    expect(ok).toEqual({ status: "ok", doc: { ...current, name: "新名", updatedAt: "t1" } });
    expect(commitWorkflowPut(undefined, current, "t1")).toEqual({ status: "missing" });
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
