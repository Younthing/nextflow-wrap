"use client";

import * as React from "react";

const AssistantModulesContext = React.createContext<((id: string) => () => void) | null>(null);

/**
 * Tracks mounted assistant modules. The provider forwards the id list on the
 * next chat request. Cleanup drops an id when its page unmounts — the stub
 * a per-page lifecycle can call without the host learning each scenario.
 */
export function AssistantModuleHost({
  children,
  onChange,
}: {
  children: React.ReactNode;
  onChange: (ids: readonly string[]) => void;
}) {
  const counts = React.useRef(new Map<string, number>());

  const mount = React.useCallback((id: string) => {
    const map = counts.current;
    map.set(id, (map.get(id) ?? 0) + 1);
    onChange([...map.keys()]);
    return () => {
      const left = (map.get(id) ?? 1) - 1;
      if (left <= 0) map.delete(id);
      else map.set(id, left);
      onChange([...map.keys()]);
    };
  }, [onChange]);

  return <AssistantModulesContext value={mount}>{children}</AssistantModulesContext>;
}

/** Marks `id` active while this component is mounted. No-op outside the host. */
export function useAssistantModule(id: string) {
  const mount = React.useContext(AssistantModulesContext);
  React.useLayoutEffect(() => {
    if (!mount) return;
    return mount(id);
  }, [mount, id]);
}
