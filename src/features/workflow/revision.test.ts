import { describe, expect, it } from "vitest";

import { emptyWorkflow } from "./document";
import { commitWorkflowPut, keepLocalWorkflowEdits, nextWorkflowRevision, revisionIsOlder, workflowWriteIsStale } from "./revision";

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

describe("nextWorkflowRevision", () => {
  it("uses a later clock value as-is", () => {
    expect(nextWorkflowRevision("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.010Z")).toBe("2026-01-01T00:00:00.010Z");
  });

  it("moves at least one millisecond past a revision minted in the same instant", () => {
    const current = "2026-01-01T00:00:00.000Z";
    const next = nextWorkflowRevision(current, current);
    expect(next > current).toBe(true);
    expect(Date.parse(next) - Date.parse(current)).toBe(1);
    const again = commitWorkflowPut(
      { ...emptyWorkflow("wf"), updatedAt: current },
      { ...emptyWorkflow("wf"), updatedAt: current, name: "saved" },
      current,
    );
    expect(again.status).toBe("ok");
    if (again.status === "ok") expect(again.doc.updatedAt > current).toBe(true);
  });
});

describe("revisionIsOlder", () => {
  it("rejects a delayed read of a revision the editor already passed", () => {
    expect(revisionIsOlder("t0", "t1")).toBe(true);
    expect(revisionIsOlder("t1", "t1")).toBe(false);
    expect(revisionIsOlder("t2", "t1")).toBe(false);
    expect(revisionIsOlder("t0", undefined)).toBe(false);
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
