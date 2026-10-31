"use client";

import * as React from "react";
import { useStore } from "zustand";
import { createActionRegistry } from "@/lib/actions";
import { createEditorStore, type EditorState, type EditorStore } from "./store";

const activeCommands = new WeakMap<
  Document,
  ReturnType<typeof createActionRegistry>
>();

const EditorContext = React.createContext<{
  store: EditorStore;
  actions: ReturnType<typeof createActionRegistry>;
} | null>(null);

/** One editor session per application or fixture, retained across route changes. */
export function EditorProvider({
  children,
  store: initialStore,
}: {
  children: React.ReactNode;
  store?: EditorStore;
}) {
  const [session] = React.useState(() => ({
    store: initialStore ?? createEditorStore(),
    actions: createActionRegistry(),
  }));
  React.useEffect(
    () => () => {
      if (activeCommands.get(document) === session.actions)
        activeCommands.delete(document);
    },
    [session],
  );
  const activate = () => activeCommands.set(document, session.actions);
  return (
    <EditorContext value={session}>
      <div
        className="contents"
        onPointerDownCapture={activate}
        onFocusCapture={activate}
      >
        {children}
      </div>
    </EditorContext>
  );
}

function useEditorSession() {
  const session = React.useContext(EditorContext);
  if (!session) throw new Error("Editor components require an EditorProvider");
  return session;
}

export function useEditorStoreApi() {
  return useEditorSession().store;
}

export function useEditorActions() {
  return useEditorSession().actions;
}

export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStoreApi(), selector);
}

/** Portals bubble through the provider too, so dialog shortcuts keep the editor that opened them. */
export function useEditorCommandScope() {
  const actions = useEditorActions();
  return React.useCallback(() => {
    const active = activeCommands.get(document);
    return !active || active === actions;
  }, [actions]);
}
