import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowDoc } from "@/features/workflow/types";

import { createEditorSaveSession, type EditorSaveRead } from "./editor-save";

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
  let session = createEditorSaveSession();
  beforeEach(() => {
    session = createEditorSaveSession();
  });

  it("runs a second save only after the first settles", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    session.enqueueEditorSave(true, async () => {
      order.push("first");
      await gate;
    });
    session.enqueueEditorSave(true, async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    await session.editorSaveSettled();
    expect(order).toEqual(["first", "second"]);
  });

  it("sends the revision the previous success acknowledged", async () => {
    const sent: WorkflowDoc[] = [];
    const save = vi.fn(async (workflow: WorkflowDoc) => {
      sent.push(workflow);
      return { ...workflow, updatedAt: workflow.updatedAt === "t0" ? "t1" : "t2" };
    });
    const run = (snapshot: EditorSaveRead) => session.runEditorSave({
      announce: false,
      snapshot,
      save,
      markSaved: () => {},
      stillOpen: () => true,
      fetchCurrent: async () => doc("t1", "server"),
      load: vi.fn(),
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    session.enqueueEditorSave(true, () => run(read("t0", "first")));
    session.enqueueEditorSave(true, () => run(read("t0", "second")));
    await session.editorSaveSettled();
    expect(sent.map((workflow) => [workflow.name, workflow.updatedAt])).toEqual([
      ["first", "t0"],
      ["second", "t1"],
    ]);
  });

  it("keeps a captured workflow when the store later holds a different document", async () => {
    let openId = "wf";
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sent: WorkflowDoc[] = [];
    const load = vi.fn();
    const run = (snapshot: EditorSaveRead, wait = false) => session.runEditorSave({
      announce: false,
      snapshot,
      save: async (workflow) => {
        sent.push(workflow);
        if (wait) await gate;
        return { ...workflow, updatedAt: workflow.updatedAt === "t0" ? "t1" : "t2" };
      },
      markSaved: vi.fn(),
      stillOpen: (_generation, docId) => openId === docId,
      fetchCurrent: async () => doc("t1", "server"),
      load,
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    session.enqueueEditorSave(true, () => run(read("t0", "A-inflight"), true));
    session.enqueueEditorSave(true, () => run(read("t0", "A-dirty")));
    await Promise.resolve();
    openId = "b";
    release();
    await session.editorSaveSettled();
    expect(sent.map((workflow) => [workflow.name, workflow.updatedAt])).toEqual([
      ["A-inflight", "t0"],
      ["A-dirty", "t1"],
    ]);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not reload the canvas when a 409 is the editor's own preceding save", async () => {
    session.noteEditorRevision("wf", "t1");
    const load = vi.fn();
    const markSaved = vi.fn();
    const save = vi.fn(async (workflow: WorkflowDoc) => {
      expect(workflow.name).toBe("newer-local");
      expect(workflow.updatedAt).toBe("t1");
      return { ...workflow, updatedAt: "t2" };
    });
    await session.runEditorSave({
      announce: false,
      snapshot: read("t0", "newer-local"),
      save,
      markSaved,
      stillOpen: () => true,
      fetchCurrent: async () => doc("t1", "already-saved"),
      load,
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    expect(load).not.toHaveBeenCalled();
    expect(markSaved).toHaveBeenCalledWith(2, "t2");
    expect(session.editorConflictIsOwnWrite("wf", "t2")).toBe(true);
  });

  it("reloads when a 409 is a newer server revision", async () => {
    session.noteEditorRevision("wf", "t0");
    const load = vi.fn();
    const server = doc("t1", "壳复验改名");
    const save = vi.fn(async () => { throw new ApiError(409, "流程已在其他地方更新，请重新打开"); });
    await session.runEditorSave({
      announce: false,
      snapshot: read("t0", "name-dirty"),
      save,
      markSaved: vi.fn(),
      stillOpen: () => true,
      fetchCurrent: async () => server,
      load,
      toastSaved: vi.fn(),
      toastError: vi.fn(),
    });
    expect(save).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(server);
  });

  it("keeps dirty local edits when the cache echoes this editor's own save", () => {
    session.noteEditorRevision("wf", "t1");
    expect(session.editorEchoKeepsLocalEdits({ docId: "wf", dirty: true }, { id: "wf", updatedAt: "t1" })).toBe(true);
    expect(session.editorEchoKeepsLocalEdits({ docId: "wf", dirty: false }, { id: "wf", updatedAt: "t1" })).toBe(false);
    expect(session.editorEchoKeepsLocalEdits({ docId: "wf", dirty: true }, { id: "wf", updatedAt: "t2" })).toBe(false);
  });
});
