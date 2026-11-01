import * as React from "react";
import { ReactFlowProvider } from "@xyflow/react";

import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { demoWorkflow } from "@/features/workflow/demo";
import { EXAMPLE_MODULES } from "@/features/workflow/example-modules";
import type { WorkflowDoc } from "@/features/workflow/types";
import { createEditorStore, type EditorStore } from "../store";
import { EditorProvider } from "../editor-provider";

export const storyModules = [...BUILTIN_MODULES, ...EXAMPLE_MODULES];

const fixtureStores = new WeakMap<Element, EditorStore>();

export function getStoryEditorStore(root: HTMLElement): EditorStore {
  const element = root.matches("[data-editor-fixture]")
    ? root
    : (root.querySelector("[data-editor-fixture]") ??
      root.closest("[data-editor-fixture]"));
  const store = element && fixtureStores.get(element);
  if (!store) throw new Error("Editor fixture is not mounted");
  return store;
}

/** Seeds the editor store so editor components render outside the app. */
export function EditorFixture({
  doc = demoWorkflow("wf_story"),
  selectedNodeIds = [],
  children,
}: {
  doc?: WorkflowDoc;
  /** Node ids to mark selected after the document loads. */
  selectedNodeIds?: readonly string[];
  children: React.ReactNode;
}) {
  // Seed synchronously on first render so children never see an empty store.
  const [store] = React.useState(() => {
    const store = createEditorStore();
    const s = store.getState();
    s.setIndex(indexModules(EXAMPLE_MODULES));
    s.load(doc);
    if (selectedNodeIds.length > 0) {
      const selected = new Set(selectedNodeIds);
      store.setState({
        nodes: store
          .getState()
          .nodes.map((node) =>
            selected.has(node.id) ? { ...node, selected: true } : node,
          ),
      });
    }
    return store;
  });
  return (
    <div
      data-editor-fixture
      className="contents"
      ref={(element) => {
        if (element) fixtureStores.set(element, store);
      }}
    >
      <EditorProvider store={store}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </EditorProvider>
    </div>
  );
}
