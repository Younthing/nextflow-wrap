import { describe, expect, it, vi } from "vitest";

import { defaultLaunchConfig } from "@/features/project/launch";
import { prepareStartRun, startConfirmView, type StartRunInput } from "@/features/editor/assistant-start-run";
import type { AcceptedRun } from "@/features/runs/assistant-actions";
import { indexModules } from "@/features/workflow/catalog";
import { fixtureReadsWorkflow } from "@/features/workflow/fixture-workflows";
import { FIXTURE_MODULES } from "@/features/workflow/fixture-modules";
import { confirmThenRun, createConfirmQueue, declinedResult, messageFromToolResult } from "./confirm";
import { composeAssistantPrompt } from "./modules/compose";
import { START_RUN_DESCRIPTION } from "./modules/canvas-edit";
import { CANCEL_RUN_DESCRIPTION, RESUME_RUN_DESCRIPTION } from "./modules/run-diagnostics";

const index = indexModules(FIXTURE_MODULES);
const qcDemoWorkflow = () => fixtureReadsWorkflow("qc-smoke");

function input(overrides: Partial<StartRunInput> = {}): StartRunInput {
  const doc = overrides.doc ?? qcDemoWorkflow();
  return {
    docId: doc.id,
    doc,
    index,
    config: defaultLaunchConfig(),
    real: false,
    runnerReady: true,
    ...overrides,
  };
}

const success = async (): Promise<AcceptedRun> => ({ accepted: true, runId: "run-1", runName: "studio_1", status: "submitted", message: "已启动 studio_1" });

describe("confirmThenRun", () => {
  const view = startConfirmView(prepareStartRun(input()));

  it("calls the run API only after the confirm button", async () => {
    const execute = vi.fn(success);
    await expect(confirmThenRun({
      isReplay: false,
      aborted: () => false,
      ask: async () => true,
      close: () => {},
      view,
      problems: () => [],
      execute,
      interruptedMessage: "确认被中断，没有启动。",
    })).resolves.toMatchObject({ accepted: true, runId: "run-1" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not call the API when the dialog is cancelled, closed, or replayed", async () => {
    const execute = vi.fn(success);
    const ask = vi.fn(async () => null);
    const cancelled = await confirmThenRun({
      isReplay: false,
      aborted: () => false,
      ask,
      close: () => {},
      view,
      problems: () => [],
      execute,
      interruptedMessage: "确认被中断，没有启动。",
    });
    expect(cancelled).toMatchObject({ accepted: false, declined: true });
    expect(execute).not.toHaveBeenCalled();

    const replayed = await confirmThenRun({
      isReplay: true,
      aborted: () => false,
      ask,
      close: () => {},
      view,
      problems: () => [],
      execute,
      interruptedMessage: "确认被中断，没有启动。",
    });
    expect(replayed.message).toMatch(/没有再次执行/);
    expect(ask).toHaveBeenCalledOnce();
  });

  it("does not open the dialog when the assistant was already stopped", async () => {
    const execute = vi.fn(success);
    const ask = vi.fn(async (): Promise<true | null> => true);
    const close = vi.fn();
    const result = await confirmThenRun({
      isReplay: false,
      aborted: () => true,
      ask,
      close,
      view,
      problems: () => [],
      execute,
      interruptedMessage: "确认被中断，没有启动。",
    });
    expect(result).toEqual(declinedResult("确认被中断，没有启动。"));
    expect(ask).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not call the API when confirm is interrupted or the plan becomes blocked", async () => {
    const execute = vi.fn(success);
    let aborted = false;
    const interrupted = await confirmThenRun({
      isReplay: false,
      aborted: () => aborted,
      ask: async () => {
        aborted = true;
        return true;
      },
      close: () => {},
      view,
      problems: () => [],
      execute,
      interruptedMessage: "确认被中断，没有启动。",
    });
    expect(interrupted).toEqual(declinedResult("确认被中断，没有启动。"));

    const blocked = await confirmThenRun({
      isReplay: false,
      aborted: () => false,
      ask: async () => true,
      close: () => {},
      view,
      problems: () => ["这次运行已经结束，不能再停止。"],
      execute,
      interruptedMessage: "确认被中断，没有停止。",
    });
    expect(blocked).toMatchObject({ accepted: false, blocked: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an info dialog's problems without executing", async () => {
    const execute = vi.fn(success);
    const blockedView = startConfirmView(prepareStartRun(input({ docId: "" })));
    const result = await confirmThenRun({
      isReplay: false,
      aborted: () => false,
      ask: async () => null,
      close: () => {},
      view: blockedView,
      problems: () => blockedView.problems,
      execute,
      interruptedMessage: "确认被中断，没有启动。",
    });
    expect(blockedView.type).toBe("info");
    expect(result).toMatchObject({ blocked: true, problems: expect.arrayContaining(["请先保存流程（Ctrl+S）"]) });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports an API failure after the user has confirmed", async () => {
    const result = await confirmThenRun({
      isReplay: false,
      aborted: () => false,
      ask: async () => true,
      close: () => {},
      view,
      problems: () => [],
      execute: async () => { throw new Error("Runner 未就绪"); },
      interruptedMessage: "确认被中断，没有启动。",
    });
    expect(result).toMatchObject({ accepted: true, error: "Runner 未就绪" });
    expect(messageFromToolResult(JSON.stringify(result))).toMatch(/Runner 未就绪/);
  });
});

describe("confirm queue and saving", () => {
  it("runs a second confirmation only after the first one finishes", async () => {
    const enqueue = createConfirmQueue();
    const order: string[] = [];
    let release: () => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const first = enqueue(async () => {
      order.push("first");
      markStarted();
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("first-done");
    });
    const second = enqueue(async () => { order.push("second"); });
    await started;
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "first-done", "second"]);
  });
});

describe("assistant prompt", () => {
  it("tells the model to wait for confirmation", () => {
    expect(composeAssistantPrompt(["canvas-edit", "run-diagnostics"])).toContain("start_run");
    expect(composeAssistantPrompt(["canvas-edit", "run-diagnostics"])).toContain("cancel_run");
    expect(composeAssistantPrompt(["canvas-edit", "run-diagnostics"])).toContain("resume_run");
    expect(composeAssistantPrompt(["canvas-edit", "run-diagnostics"])).toMatch(/确认/);
    expect(composeAssistantPrompt(["canvas-edit", "run-diagnostics"])).not.toContain("你不能启动或停止运行");
    for (const text of [START_RUN_DESCRIPTION, CANCEL_RUN_DESCRIPTION, RESUME_RUN_DESCRIPTION]) {
      expect(text).toMatch(/确认/);
      expect(text).toMatch(/等这个工具返回/);
    }
  });
});
