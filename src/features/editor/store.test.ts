import { beforeEach, describe, expect, it } from "vitest";

import { emptyWorkflow } from "@/features/workflow/document";
import { useEditorStore } from "./store";

describe("editor store history", () => {
  beforeEach(() => useEditorStore.getState().load(emptyWorkflow("wf", "原名")));

  it("undoes and redoes a rename", () => {
    const s = useEditorStore.getState();
    s.setName("新名字");
    s.undo();
    expect(useEditorStore.getState().name).toBe("原名");
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().name).toBe("新名字");
  });

  it("bumps the generation on every load", () => {
    const before = useEditorStore.getState().generation;
    useEditorStore.getState().load(emptyWorkflow(""));
    expect(useEditorStore.getState().generation).toBe(before + 1);
  });
});
