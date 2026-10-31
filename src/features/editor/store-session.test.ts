import { describe, expect, it } from "vitest";

import { createEditorActions } from "@/features/assistant/editor-actions";
import { BUILTIN_MODULES, SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { emptyWorkflow } from "@/features/workflow/document";
import { createEditorSaveSession, getEditorSaveSession } from "./editor-save";
import { createEditorStore, selectIsDirty } from "./store";

function session(name: string) {
  const store = createEditorStore();
  store.getState().setIndex(indexModules(BUILTIN_MODULES));
  store.getState().load(emptyWorkflow(name, name));
  return store;
}

describe("editor sessions", () => {
  it("keeps document edits, clipboard and undo history in their owning store", () => {
    const first = session("first");
    const second = session("second");
    const actions = createEditorActions(first);
    actions.addModule({ moduleId: SAMPLESHEET_ID });
    first.getState().copySelected();
    actions.setParam("outdir", "first-results");
    expect(first.getState().clipboard?.nodes).toHaveLength(1);
    expect(second.getState().clipboard).toBeNull();
    expect(second.getState().nodes).toEqual([]);
    expect(second.getState().params.outdir).not.toBe("first-results");
    expect(second.getState().past).toEqual([]);
    expect(selectIsDirty(second.getState())).toBe(false);
    first.getState().undo();
    expect(first.getState().params.outdir).not.toBe("first-results");
    expect(second.getState().name).toBe("second");
  });

  it("reads assistant summaries from the injected store", () => {
    const first = session("first");
    const second = session("second");
    const firstActions = createEditorActions(first);
    const secondActions = createEditorActions(second);
    firstActions.addModule({ moduleId: SAMPLESHEET_ID, alias: "FIRST_INPUT" });
    expect(
      firstActions.workflowSummary().nodes.map((node) => node.alias),
    ).toEqual(["FIRST_INPUT"]);
    expect(secondActions.workflowSummary()).toMatchObject({
      name: "second",
      nodes: [],
    });
  });

  it("does not treat another editor's save as its own acknowledged revision", () => {
    const first = session("first");
    const second = session("second");
    const firstSaves = getEditorSaveSession(first);
    const secondSaves = getEditorSaveSession(second);
    expect(getEditorSaveSession(first)).toBe(firstSaves);
    firstSaves.noteEditorRevision("same-workflow", "2026-01-02T00:00:00.000Z");
    expect(
      firstSaves.editorConflictIsOwnWrite(
        "same-workflow",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(secondSaves.editorKnownRevision("same-workflow")).toBeUndefined();
    expect(
      secondSaves.editorConflictIsOwnWrite(
        "same-workflow",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("allows another editor to save while the first editor waits on a request", async () => {
    const first = createEditorSaveSession();
    const second = createEditorSaveSession();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = first.enqueueEditorSave(true, async () => {
      await gate;
      events.push("first");
    });
    await second.enqueueEditorSave(true, async () => {
      events.push("second");
    });
    expect(events).toEqual(["second"]);
    release();
    await pending;
    expect(events).toEqual(["second", "first"]);
  });
});
