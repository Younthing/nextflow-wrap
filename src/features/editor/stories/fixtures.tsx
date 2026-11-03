import * as React from "react";
import { ReactFlowProvider } from "@xyflow/react";

import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { fixtureWorkflow } from "@/features/workflow/fixture-workflows";
import { FIXTURE_MODULES } from "@/features/workflow/fixture-modules";
import type { ModuleDef, WorkflowDoc } from "@/features/workflow/types";
import { createEditorStore, type EditorStore } from "../store";
import { EditorProvider } from "../editor-provider";

export const storyModules = [...BUILTIN_MODULES, ...FIXTURE_MODULES];

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
  doc = fixtureWorkflow("wf_story"),
  selectedNodeIds = [],
  modules = FIXTURE_MODULES,
  children,
}: {
  doc?: WorkflowDoc;
  /** Catalog modules the canvas resolves nodes against. */
  modules?: readonly ModuleDef[];
  /** Node ids to mark selected after the document loads. */
  selectedNodeIds?: readonly string[];
  children: React.ReactNode;
}) {
  // Seed synchronously on first render so children never see an empty store.
  const [store] = React.useState(() => {
    const store = createEditorStore();
    const s = store.getState();
    s.setIndex(indexModules([...modules]));
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
