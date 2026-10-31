"use client";

import * as React from "react";

import {
  actionRegistry,
  formatShortcut,
  handleShortcutKey,
  isDialogOpen,
  isEditableTarget,
  primaryCombo,
  type KeyCombo,
  type ShortcutPlatform,
} from "@/lib/actions";

function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const platform = `${uaData ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(platform) ? "mac" : "other";
}

/** Server and the first hydration render stay on Ctrl so the markup matches. Mac then swaps in ⌘. */
export function useShortcutPlatform(): ShortcutPlatform {
  return React.useSyncExternalStore(
    () => () => {},
    detectShortcutPlatform,
    () => "other",
  );
}

export function useShortcutLabel(shortcut: KeyCombo | readonly KeyCombo[]): string {
  return formatShortcut(primaryCombo(shortcut), useShortcutPlatform());
}

/**
 * Mount once, next to the commands it should hear. The listener reads the
 * registry at keydown time, so commands registered later (canvas menus) are picked up
 * without another listener.
 */
export function useActionShortcuts() {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handled = handleShortcutKey(actionRegistry.list(), event, {
        typing: isEditableTarget(event.target),
        dialogOpen: isDialogOpen(),
      });
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
