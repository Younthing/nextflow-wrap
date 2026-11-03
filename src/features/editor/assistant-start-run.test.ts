import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultLaunchConfig } from "@/features/project/launch";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import { fixtureReadsWorkflow } from "@/features/workflow/fixture-workflows";
import { FIXTURE_MODULES } from "@/features/workflow/fixture-modules";
import type { WorkflowDoc } from "@/features/workflow/types";
import { ensureWorkflowSaved, prepareStartRun, startConfirmView, startPlanStamp, type StartRunInput } from "./assistant-start-run";
import { getEditorSaveSession, type EditorSaveRead } from "./editor-save";
import { createEditorStore, selectIsDirty, type EditorStore } from "./store";

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


describe("prepareStartRun", () => {
  it("builds the same kind of request the run dialog submits", () => {
    const plan = prepareStartRun(input());
    expect(plan.problems).toEqual([]);
    expect(plan.request).toMatchObject({
      params: { input: "assets/samplesheet.csv", outdir: "results" },
      launch: { executor: "local", engine: "shell", resume: false },
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

  it("keeps the chosen executor and profile on a real launch and blocks when the runner is down", () => {
    const plan = prepareStartRun(input({
      real: true,
      runnerReady: false,
      diagnostics: "Docker 没启动",
      config: { ...defaultLaunchConfig(), executor: "slurm", engine: "singularity", resume: true, settings: { queue: "normal" } },
    }));
    expect(plan.launch).toMatchObject({ executor: "slurm", engine: "singularity", resume: false });
    expect(plan.command).toContain("-profile singularity");
    expect(plan.runConfig).toContain("process.executor = 'slurm'");
    const shell = prepareStartRun(input({
      real: true,
      runnerReady: true,
      config: { ...defaultLaunchConfig(), engine: "shell" },
    }));
    expect(shell.launch.engine).toBe("shell");
    expect(shell.command).not.toContain("-profile");
    expect(plan.launch.settings).toEqual({ queue: "normal" });
    expect(shell.launch.settings).toMatchObject({ cpus: 2, memory: "2.GB" });
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

describe("ensureWorkflowSaved", () => {
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

