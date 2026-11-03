"use client";

import * as React from "react";

/**
 * What the workbench's copy and cut put aside for paste, kept for the session: project files by workspace path, or a
 * notebook. It is separate from the system clipboard, which "复制路径" writes.
 */
export type WorkbenchClip =
  | { kind: "files"; projectId: string; paths: string[]; mode: "copy" | "move" }
  | { kind: "notebook"; id: string; name: string };

let clip: WorkbenchClip | null = null;
const listeners = new Set<() => void>();

export function setClip(next: WorkbenchClip | null) {
  clip = next;
  for (const listener of listeners) listener();
}

export function getClip(): WorkbenchClip | null {
  return clip;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useClip(): WorkbenchClip | null {
  return React.useSyncExternalStore(subscribe, getClip, () => null);
}
