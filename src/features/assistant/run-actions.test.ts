import { beforeEach, describe, expect, it, vi } from "vitest";

import catalog from "@/data/nf-core-modules.json";
import { getEditorSaveSession, type EditorSaveRead } from "@/features/editor/editor-save";
import { createEditorStore, selectIsDirty, type EditorStore } from "@/features/editor/store";
import { defaultLaunchConfig } from "@/features/project/launch";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import { qcDemoWorkflow } from "@/features/workflow/qc-demo";
import type { ModuleCatalog, WorkflowDoc } from "@/features/workflow/types";
import { ASSISTANT_PROMPT } from "./prompt";
import {
  CANCEL_RUN_DESCRIPTION,
  RESUME_RUN_DESCRIPTION,
  START_RUN_DESCRIPTION,
  cancelBlockers,
  cancelConfirmView,
  confirmThenRun,
  createConfirmQueue,
  declinedResult,
  ensureWorkflowSaved,
  messageFromToolResult,
  prepareStartRun,
  resumeBlockers,
  resumeConfirmView,
  startConfirmView,
  startPlanStamp,
  type AcceptedRun,
  type StartRunInput,
} from "./run-actions";

const typed = catalog as ModuleCatalog;
const index = indexModules(typed.modules);

function input(overrides: Partial<StartRunInput> = {}): StartRunInput {
  const doc = overrides.doc ?? qcDemoWorkflow();
  return {
    docId: doc.id,
    doc,
    index,
    modulesSha: typed.gitSha,
    config: defaultLaunchConfig(),
    real: false,
    runnerReady: true,
    ...overrides,
  };
}

const success = async (): Promise<AcceptedRun> => ({ accepted: true, runId: "run-1", runName: "studio_1", status: "submitted", message: "已启动 studio_1" });

describe("prepareStartRun", () => {
  it("builds the same kind of request the run dialog submits", () => {
    const plan = prepareStartRun(input());
    expect(plan.problems).toEqual([]);
    expect(plan.request).toMatchObject({
      modulesSha: typed.gitSha,
      params: { input: "assets/samplesheet.csv", outdir: "results" },
      launch: { executor: "local", engine: "docker", resume: false },
      command: expect.stringContaining("nextflow run ."),
    });
    expect(plan.request?.project.files.some((file) => file.path === "main.nf")).toBe(true);
    expect(startConfirmView(plan).type).toBe("default");
  });

  it("refuses an unsaved workflow and a workflow that cannot be generated", () => {
    expect(prepareStartRun(input({ docId: "" })).problems).toContain("请先保存流程（Ctrl+S）");
    expect(prepareStartRun(input({ docId: "" })).request).toBeNull();

    const fastqc = qcDemoWorkflow().nodes[1];
    const broken = prepareStartRun(input({ doc: { ...qcDemoWorkflow(), nodes: [fastqc], edges: [] } }));
    expect(broken.request).toBeNull();
    expect(broken.problems.join(" ")).toMatch(/未连接|样本表/);
    expect(startConfirmView(broken).type).toBe("info");
  });

  it("locks a real launch to local docker and blocks when the runner is down", () => {
    const plan = prepareStartRun(input({
      real: true,
      runnerReady: false,
      diagnostics: "Docker 没启动",
      config: { ...defaultLaunchConfig(), executor: "slurm", engine: "singularity", resume: true, settings: { queue: "normal" } },
    }));
    expect(plan.launch).toMatchObject({ executor: "local", engine: "docker", resume: false });
    const shell = prepareStartRun(input({
      real: true,
      runnerReady: true,
      config: { ...defaultLaunchConfig(), engine: "shell" },
    }));
    expect(shell.launch.engine).toBe("shell");
    expect(shell.command).not.toContain("-profile");
    expect(plan.launch.settings).toMatchObject({ cpus: 2, memory: "2.GB", queue: "normal" });
    expect(plan.problems).toContain("Docker 没启动");
    expect(plan.request).toBeNull();
  });

  it("ignores updatedAt when comparing the plan the user confirmed", () => {
    const doc = qcDemoWorkflow();
    const first = prepareStartRun(input({ doc: { ...doc, updatedAt: "a" } }));
    const second = prepareStartRun(input({ doc: { ...doc, updatedAt: "b" } }));
    expect(startPlanStamp(first)).toBe(startPlanStamp(second));
    const changed = prepareStartRun(input({ doc: { ...doc, params: { ...doc.params, outdir: "elsewhere" } } }));
    expect(startPlanStamp(changed)).not.toBe(startPlanStamp(first));
  });

  it("reports a missing catalog instead of launching", () => {
    const plan = prepareStartRun(input({ index: new Map(), catalogError: "模块库加载失败：离线" }));
    expect(plan.request).toBeNull();
    expect(plan.problems).toContain("模块库加载失败：离线");
  });
});

describe("cancel and resume confirmation", () => {
  it("uses a destructive confirm only while the run can be stopped", () => {
    expect(cancelBlockers({ status: "running" })).toEqual([]);
    expect(cancelConfirmView("tender_curie", []).type).toBe("delete");
    expect(cancelBlockers({ status: "running", phase: "cancelling" })).toEqual(["这次运行正在停止。"]);
    expect(cancelConfirmView("tender_curie", cancelBlockers({ status: "succeeded" })).type).toBe("info");
  });

  it("requires a finished run with a Nextflow session before resume", () => {
    expect(resumeBlockers({ status: "running", nextflowSessionId: "ses" })).toEqual(["运行还在进行，不能恢复。可以先停止，或等它结束。"]);
    expect(resumeBlockers({ status: "failed" })).toEqual(["这次运行没有 Nextflow session，不能从这里恢复。"]);
    expect(resumeConfirmView("tender_curie", []).type).toBe("default");
    expect(resumeConfirmView("tender_curie", resumeBlockers({ status: "failed" })).type).toBe("info");
  });
});

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

  let store: EditorStore;
  beforeEach(() => {
    store = createEditorStore();
    store.getState().load(qcDemoWorkflow());
  });

  it("saves a dirty workflow once and refuses one that was never saved", async () => {
    expect(selectIsDirty(store.getState())).toBe(false);
    const idle = vi.fn(async (doc: WorkflowDoc) => doc);
    await expect(ensureWorkflowSaved(idle, store)).resolves.toMatchObject({ doc: { id: "qc-smoke" } });
    expect(idle).not.toHaveBeenCalled();

    store.getState().setName("改过的名字");
    const save = vi.fn(async (doc: WorkflowDoc) => doc);
    await expect(ensureWorkflowSaved(save, store)).resolves.toMatchObject({ doc: { name: "改过的名字" } });
    expect(save).toHaveBeenCalledOnce();
    expect(selectIsDirty(store.getState())).toBe(false);

    store.getState().load(emptyWorkflow(""));
    const again = vi.fn();
    await expect(ensureWorkflowSaved(again, store)).resolves.toEqual({ error: "请先保存流程（Ctrl+S）" });
    expect(again).not.toHaveBeenCalled();
  });

  it("waits for an in-flight editor save and then uses the revision it stored", async () => {
    const base = qcDemoWorkflow();
    base.updatedAt = "2020-01-01T00:00:00.000Z";
    store.getState().load(base);
    store.getState().setName("autosaved");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sent: string[] = [];
    const state = store.getState();
    const snapshot: EditorSaveRead = {
      docId: state.docId,
      revision: state.revision,
      generation: state.generation,
      dirty: true,
      doc: state.toDoc(),
      issues: [],
    };
    const session = getEditorSaveSession(store);
    session.enqueueEditorSave(true, (announce) => session.runEditorSave({
      announce,
      snapshot,
      save: async (doc) => {
        sent.push(doc.updatedAt);
        await gate;
        return { ...doc, updatedAt: "2020-01-02T00:00:00.000Z" };
      },
      markSaved: (revision, updatedAt) => store.getState().markSaved(revision, updatedAt),
      stillOpen: () => true,
      fetchCurrent: async () => store.getState().toDoc(),
      load: () => {},
      toastSaved: () => {},
      toastError: () => {},
    }));
    store.getState().setName("and-then");
    const pending = ensureWorkflowSaved(async (doc) => {
      sent.push(`assistant:${doc.updatedAt}:${doc.name}`);
      return { ...doc, updatedAt: "2020-01-03T00:00:00.000Z" };
    }, store);
    await Promise.resolve();
    release();
    const result = await pending;
    expect(sent[0]).toBe("2020-01-01T00:00:00.000Z");
    expect(sent[1]).toBe("assistant:2020-01-02T00:00:00.000Z:and-then");
    expect(result).toMatchObject({ doc: { name: "and-then" } });
    expect("error" in result).toBe(false);
  });
});

describe("assistant prompt", () => {
  it("tells the model to wait for confirmation", () => {
    expect(ASSISTANT_PROMPT).toContain("start_run");
    expect(ASSISTANT_PROMPT).toContain("cancel_run");
    expect(ASSISTANT_PROMPT).toContain("resume_run");
    expect(ASSISTANT_PROMPT).toMatch(/确认/);
    expect(ASSISTANT_PROMPT).not.toContain("你不能启动或停止运行");
    for (const text of [START_RUN_DESCRIPTION, CANCEL_RUN_DESCRIPTION, RESUME_RUN_DESCRIPTION]) {
      expect(text).toMatch(/确认/);
      expect(text).toMatch(/等这个工具返回/);
    }
  });
});
