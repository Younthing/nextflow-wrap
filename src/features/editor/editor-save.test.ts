import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowDoc } from "@/features/workflow/types";

import {
  editorConflictIsOwnWrite,
  editorSaveSettled,
  enqueueEditorSave,
  noteEditorRevision,
  resetEditorSaveQueueForTests,
  runEditorSave,
  type EditorSaveRead,
} from "./editor-save";

function doc(updatedAt: string, name: string): WorkflowDoc {
  return { ...emptyWorkflow("wf", name), updatedAt };
}

function read(updatedAt: string, name: string, dirty = true): EditorSaveRead {
  return {
    docId: "wf",
    revision: 2,
    generation: 1,
    dirty,
    doc: doc(updatedAt, name),
    issues: [],
  };
}

describe("editor save queue", () => {
  beforeEach(() => resetEditorSaveQueueForTests());

  it("runs a second save only after the first settles", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    enqueueEditorSave(true, async () => {
      order.push("first");
      await gate;
    });
    enqueueEditorSave(true, async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    await editorSaveSettled();
    expect(order).toEqual(["first", "second"]);
  });

  it("sends the revision the previous success acknowledged", async () => {
    const sent: string[] = [];
    let updatedAt = "t0";
    let dirty = true;
    const save = vi.fn(async (workflow: WorkflowDoc) => {
      sent.push(workflow.updatedAt);
      const next = { ...workflow, updatedAt: workflow.updatedAt === "t0" ? "t1" : "t2" };
      updatedAt = next.updatedAt;
      dirty = workflow.name === "first";
      return next;
    });
    const run = (announce: boolean) => runEditorSave({
      announce,
      read: () => read(updatedAt, dirty ? (updatedAt === "t0" ? "first" : "second") : "second", dirty),
      save,
      markSaved: (_revision, at) => { updatedAt = at; noteEditorRevision("wf", at); },
      stillOpen: () => true,
      fetchCurrent: async () => doc(updatedAt, "server"),
      load: vi.fn(),
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    enqueueEditorSave(true, () => run(false));
    enqueueEditorSave(true, () => run(false));
    await editorSaveSettled();
    expect(sent).toEqual(["t0", "t1"]);
  });

  it("does not reload the canvas when a 409 is the editor's own preceding save", async () => {
    noteEditorRevision("wf", "t1");
    let phase: "stale" | "fresh" = "stale";
    const load = vi.fn();
    const markSaved = vi.fn();
    await runEditorSave({
      announce: false,
      read: () => phase === "stale" ? read("t0", "newer-local") : read("t1", "newer-local"),
      save: async (workflow) => {
        if (workflow.updatedAt === "t0") {
          phase = "fresh";
          throw new ApiError(409, "流程已在其他地方更新，请重新打开");
        }
        return { ...workflow, updatedAt: "t2" };
      },
      markSaved,
      stillOpen: () => true,
      fetchCurrent: async () => doc("t1", "already-saved"),
      load,
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    expect(load).not.toHaveBeenCalled();
    expect(markSaved).toHaveBeenCalledWith(2, "t2");
    expect(editorConflictIsOwnWrite("wf", "t2")).toBe(true);
  });

  it("reloads when a 409 is a newer server revision", async () => {
    noteEditorRevision("wf", "t0");
    const load = vi.fn();
    const server = doc("t1", "壳复验改名");
    await runEditorSave({
      announce: false,
      read: () => read("t0", "name-dirty"),
      save: async () => { throw new ApiError(409, "流程已在其他地方更新，请重新打开"); },
      markSaved: vi.fn(),
      stillOpen: () => true,
      fetchCurrent: async () => server,
      load,
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    expect(load).toHaveBeenCalledWith(server);
  });
});
