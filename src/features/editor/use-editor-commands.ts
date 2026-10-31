"use client";

import * as React from "react";
import { useStoreApi } from "@xyflow/react";

import { useActionShortcuts } from "@/lib/use-action-shortcuts";
import { editorActions } from "./commands";
import { selectHasSelection } from "./store";
import {
  useEditorStoreApi,
  useEditorActions,
  useEditorCommandScope,
} from "./editor-provider";

export type EditorCanvasCommands = {
  save: () => void;
  openNodeSearch: () => void;
  fitView: () => void;
};

/** Registers editor commands for as long as the editor is mounted, and listens for their chords. */
export function useEditorCommands({
  save,
  openNodeSearch,
  fitView,
}: EditorCanvasCommands) {
  const store = useEditorStoreApi();
  const actionRegistry = useEditorActions();
  const isActive = useEditorCommandScope();
  const flowStore = useStoreApi();
  // Callbacks from the editor change identity; chords should call the latest ones.
  const commandsRef = React.useRef({ save, openNodeSearch, fitView });
  React.useEffect(() => {
    commandsRef.current = { save, openNodeSearch, fitView };
  });

  React.useEffect(() => {
    return actionRegistry.registerAll(
      editorActions({
        save: () => commandsRef.current.save(),
        undo: () => store.getState().undo(),
        redo: () => store.getState().redo(),
        copy: () => store.getState().copySelected(),
        paste: () => store.getState().pasteFromClipboard(),
        duplicate: () => store.getState().duplicateSelected(),
        delete: () => {
          store.getState().deleteSelected();
          // A shift-drag leaves the selection rectangle up after the nodes are gone.
          flowStore.setState({ nodesSelectionActive: false });
        },
        selectAll: () => store.getState().selectAllNodes(),
        deselect: () => store.getState().clearSelection(),
        openNodeSearch: () => commandsRef.current.openNodeSearch(),
        fitView: () => commandsRef.current.fitView(),
        canUndo: () => store.getState().past.length > 0,
        canRedo: () => store.getState().future.length > 0,
        canCopy: () => store.getState().nodes.some((node) => node.selected),
        canPaste: () => (store.getState().clipboard?.nodes.length ?? 0) > 0,
        canDuplicate: () =>
          store.getState().nodes.some((node) => node.selected),
        canDelete: () => selectHasSelection(store.getState()),
        canSelectAll: () => store.getState().nodes.length > 0,
        canDeselect: () => selectHasSelection(store.getState()),
        canFitView: () => store.getState().nodes.length > 0,
      }),
    );
  }, [flowStore, store, actionRegistry]);

  useActionShortcuts(actionRegistry, isActive);
}
