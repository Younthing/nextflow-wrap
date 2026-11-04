import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNotebookActions } from "./assistant-actions";
import { createNotebookSession, NOTEBOOK_AUTOSAVE_MS, type NotebookSessionPorts } from "./session";
import { simulateCells } from "./simulate";
import { fixtureNotebooks } from "./test-fixtures";
import type { NotebookDoc, NotebookRunResult } from "./types";

function fixture(id: string): NotebookDoc {
  const doc = fixtureNotebooks(0).find((item) => item.id === id);
  if (!doc) throw new Error(`no fixture ${id}`);
  return doc;
}

function open(id = "qc_summary") {
  const saved = fixture(id);
  const calls: string[] = [];
  let server = saved;
  const ports = {
    save: vi.fn(async (doc: NotebookDoc) => {
      calls.push("save");
      server = { ...doc, updatedAt: `${Number(server.updatedAt.length)}` };
      return server;
    }),
    run: vi.fn(async ({ cellId }: { id: string; cellId?: string }): Promise<NotebookRunResult> => {
      calls.push(`run:${cellId ?? "all"}`);
      return { cells: simulateCells(server, cellId), kernel: { mode: "jupyter", kernel: "python3" } };
    }),
  } satisfies NotebookSessionPorts;
  let now = 0;
  const session = createNotebookSession({ notebookId: id, saved, ports, clock: () => (now += 5) });
  return { session, ports, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("notebook session", () => {
  it("keeps edits in the draft and autosaves them after a pause", async () => {
    const { session, ports } = open();
    session.update({ name: "改名" });
    session.update({ description: "说明" });
    expect(session.doc()).toMatchObject({ name: "改名", description: "说明" });
    expect(session.store.getState().draft).not.toBeNull();
    await vi.advanceTimersByTimeAsync(NOTEBOOK_AUTOSAVE_MS);
    expect(ports.save).toHaveBeenCalledOnce();
    expect(session.store.getState().draft).toBeNull();
    expect(session.store.getState().saved).toMatchObject({ name: "改名", description: "说明" });
  });

  it("keeps an edit made while a save was in flight", async () => {
    const { session, ports } = open();
    let release: (doc: NotebookDoc) => void = () => {};
    ports.save.mockImplementationOnce((doc) => new Promise((resolve) => { release = () => resolve(doc); }));
    session.update({ name: "first" });
    await vi.advanceTimersByTimeAsync(NOTEBOOK_AUTOSAVE_MS);
    session.update({ name: "second" });
    release(fixture("qc_summary"));
    await vi.runOnlyPendingTimersAsync();
    expect(session.doc()?.name).toBe("second");
  });

  it("saves a dirty draft before running a cell, like Shift+Enter", async () => {
    const { session, calls } = open();
    session.setCells(session.read().doc.cells.map((cell) => (cell.id === "c2" ? { ...cell, source: "print(1)\n" } : cell)));
    const result = await session.runCell("c2");
    expect(calls).toEqual(["save", "run:c2"]);
    expect(result.cells.some((cell) => cell.id === "c2")).toBe(true);
    const state = session.store.getState();
    expect(state.draft).toBeNull();
    expect(state.outputs.c2).toBeDefined();
    expect(state.durations.c2).toBeGreaterThan(0);
    expect(state.running).toBeNull();
    await vi.advanceTimersByTimeAsync(NOTEBOOK_AUTOSAVE_MS);
    expect(calls).toEqual(["save", "run:c2"]);
  });

  it("refuses a second run while one holds the session, and reports run errors", async () => {
    const { session, ports } = open();
    let release: () => void = () => {};
    ports.run.mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject(new Error("kernel died")); }));
    const first = session.runCell("c2");
    expect(session.read().busy).toBe(true);
    expect(session.store.getState().running).toBe("c2");
    await expect(session.runCell("c2")).rejects.toThrow(/正在运行/);
    release();
    await expect(first).rejects.toThrow("kernel died");
    expect(session.store.getState().runError).toBe("kernel died");
    expect(session.read().busy).toBe(false);
  });

  it("Run All replaces every output; clearOutput drops one or all", async () => {
    const { session } = open();
    await session.runCell("c2");
    session.runAll();
    expect(session.store.getState().running).toBe("all");
    await vi.runOnlyPendingTimersAsync();
    const outputs = session.store.getState().outputs;
    expect(Object.keys(outputs).length).toBeGreaterThan(1);
    session.clearOutput("c2");
    expect(session.store.getState().outputs.c2).toBeUndefined();
    session.clearOutput();
    expect(session.store.getState().outputs).toEqual({});
  });

  it("is what the assistant tools edit and run, and reveals the touched cell", async () => {
    const { session, calls } = open();
    const revealed: string[] = [];
    const stop = session.onReveal((id) => revealed.push(id));
    const actions = createNotebookActions(session, (role, source = "") => ({ id: "n1", role, source }));
    actions.editCell({ editType: "insert", cellId: "c2", source: "print('hi')\n" });
    expect(revealed).toEqual(["n1"]);
    expect(session.doc()?.cells.map((cell) => cell.id)).toContain("n1");
    await expect(actions.prepareRunCell("n1").invoke()).resolves.toMatchObject({ accepted: true, cellId: "n1" });
    expect(calls).toEqual(["save", "run:n1"]);
    stop();
    actions.editCell({ editType: "delete", cellId: "n1" });
    expect(revealed).toEqual(["n1"]);
  });
});
