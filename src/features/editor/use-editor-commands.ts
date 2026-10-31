"use client";

import * as React from "react";

import { actionRegistry } from "@/lib/actions";
import { useActionShortcuts } from "@/lib/use-action-shortcuts";
import { editorActions } from "./commands";
import { selectHasSelection, useEditorStore } from "./store";

export type EditorCanvasCommands = {
  save: () => void;
  openNodeSearch: () => void;
  fitView: () => void;
};

function hasSelectedNodes() {
  return useEditorStore.getState().nodes.some((node) => node.selected);
}

/** Registers editor commands for as long as the editor is mounted, and listens for their chords. */
export function useEditorCommands({ save, openNodeSearch, fitView }: EditorCanvasCommands) {
  // Callbacks from the editor change identity; chords should call the latest ones.
  const commandsRef = React.useRef({ save, openNodeSearch, fitView });
  React.useEffect(() => {
    commandsRef.current = { save, openNodeSearch, fitView };
  });

  React.useEffect(() => {
    return actionRegistry.registerAll(
      editorActions({
        save: () => commandsRef.current.save(),
        undo: () => useEditorStore.getState().undo(),
        redo: () => useEditorStore.getState().redo(),
        copy: () => useEditorStore.getState().copySelected(),
        paste: () => useEditorStore.getState().pasteFromClipboard(),
        duplicate: () => useEditorStore.getState().duplicateSelected(),
        selectAll: () => useEditorStore.getState().selectAllNodes(),
        deselect: () => useEditorStore.getState().clearSelection(),
        openNodeSearch: () => commandsRef.current.openNodeSearch(),
        fitView: () => commandsRef.current.fitView(),
        canUndo: () => useEditorStore.getState().past.length > 0,
        canRedo: () => useEditorStore.getState().future.length > 0,
        canCopy: hasSelectedNodes,
        canPaste: () => (useEditorStore.getState().clipboard?.nodes.length ?? 0) > 0,
        canDuplicate: hasSelectedNodes,
        canSelectAll: () => useEditorStore.getState().nodes.length > 0,
        canDeselect: () => selectHasSelection(useEditorStore.getState()),
        canFitView: () => useEditorStore.getState().nodes.length > 0,
      }),
    );
  }, []);

  useActionShortcuts();
}
