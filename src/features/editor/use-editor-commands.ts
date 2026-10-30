"use client";

import * as React from "react";

import { actionRegistry } from "@/lib/actions";
import { useActionShortcuts } from "@/lib/use-action-shortcuts";
import { editorActions } from "./commands";
import { useEditorStore } from "./store";

/** Registers save, undo, and redo for as long as the editor is mounted, and listens for their chords. */
export function useEditorCommands(save: () => void) {
  // doSave's identity changes every render; the chord should always call the latest one.
  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  });

  React.useEffect(() => {
    return actionRegistry.registerAll(
      editorActions({
        save: () => saveRef.current(),
        undo: () => useEditorStore.getState().undo(),
        redo: () => useEditorStore.getState().redo(),
        canUndo: () => useEditorStore.getState().past.length > 0,
        canRedo: () => useEditorStore.getState().future.length > 0,
      }),
    );
  }, []);

  useActionShortcuts();
}
