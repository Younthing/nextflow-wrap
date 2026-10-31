"use client";

import * as React from "react";

import {
  actionRegistry,
  combosOf,
  formatShortcut,
  handleShortcutKey,
  isDialogOpen,
  isEditableTarget,
  isMenuOpen,
  isTextSelectionOutsideCanvas,
  primaryCombo,
  type KeyCombo,
  type ShortcutPlatform,
} from "@/lib/actions";

function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
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

export function useShortcutLabel(
  shortcut: KeyCombo | readonly KeyCombo[],
): string {
  return formatShortcut(primaryCombo(shortcut), useShortcutPlatform());
}

/** Every chord, in platform form, for help text that should list alternates. */
export function useShortcutLabels(
  shortcut: KeyCombo | readonly KeyCombo[],
): string {
  const platform = useShortcutPlatform();
  return combosOf({ shortcut })
    .map((combo) => formatShortcut(combo, platform))
    .join(" 或 ");
}

/**
 * Mount once, next to the commands it should hear. The listener reads the
 * registry at keydown time, so commands registered later (canvas menus) are picked up
 * without another listener.
 */
export function useActionShortcuts(
  registry = actionRegistry,
  isActive?: () => boolean,
) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Dialogs and menus listen on document and preventDefault (Escape) before
      // this window listener. Leave those keys alone so closing an overlay does
      // not also run a canvas command such as deselect.
      if (event.defaultPrevented || (isActive && !isActive())) return;
      const handled = handleShortcutKey(registry.list(), event, {
        typing: isEditableTarget(event.target),
        dialogOpen: isDialogOpen(),
        menuOpen: isMenuOpen(),
        textSelectionOutsideCanvas: isTextSelectionOutsideCanvas(document),
      });
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry, isActive]);
}
