import { describe, expect, it } from "vitest";
import { finishedSince, statusMap } from "./notifications";
import type { RunStatus, RunSummary } from "./types";

const run = (id: string, status: RunStatus, extra: Partial<RunSummary> = {}): RunSummary => ({
  id, status, runName: `name_${id}`, workflowId: "wf", workflowName: "PBMC", executor: "local", profile: "standard",
  submittedAt: "2026-11-01T00:00:00Z",
  progress: { total: 4, pending: 0, running: 0, completed: 3, cached: 1, failed: 0, aborted: 0 },
  ...extra,
});

describe("finishedSince", () => {
  it("announces runs that went from active to finished", () => {
    const before = statusMap([run("a", "running"), run("b", "submitted")]);
    const notices = finishedSince(before, [run("a", "succeeded"), run("b", "failed", { errorMessage: "exit 1" })]);
    expect(notices).toEqual([
      { runId: "a", status: "succeeded", title: "运行完成：PBMC", body: "name_a，4/4 个任务" },
      { runId: "b", status: "failed", title: "运行失败：PBMC", body: "exit 1" },
    ]);
  });

  it("ignores history, new finished runs and cancellations", () => {
    const before = statusMap([run("a", "succeeded"), run("c", "running")]);
    expect(finishedSince(before, [run("a", "succeeded"), run("new", "failed"), run("c", "cancelled")])).toEqual([]);
    expect(finishedSince(new Map(), [run("a", "succeeded")])).toEqual([]);
  });
});
