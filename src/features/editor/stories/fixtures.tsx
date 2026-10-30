import * as React from "react";
import { ReactFlowProvider } from "@xyflow/react";

import catalog from "@/data/nf-core-modules.json";
import { BUILTIN_MODULES } from "@/features/workflow/builtins";
import { indexModules } from "@/features/workflow/catalog";
import { demoRnaseqWorkflow } from "@/features/workflow/demo";
import type { ModuleCatalog, WorkflowDoc } from "@/features/workflow/types";
import { useEditorStore } from "../store";

export const storyCatalog = catalog as ModuleCatalog;
export const storyModules = [...BUILTIN_MODULES, ...storyCatalog.modules];

/** Seeds the editor store so editor components render outside the app. */
export function EditorFixture({
  doc = demoRnaseqWorkflow("wf_story"),
  children,
}: {
  doc?: WorkflowDoc;
  children: React.ReactNode;
}) {
  // Seed synchronously on first render so children never see an empty store.
  React.useState(() => {
    const s = useEditorStore.getState();
    s.setIndex(indexModules(storyCatalog.modules));
    s.load(doc);
    return true;
  });
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}
