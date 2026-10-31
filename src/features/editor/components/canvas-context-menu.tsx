"use client";

import * as React from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { actionRegistry } from "@/lib/actions";
import { useShortcutLabel } from "@/lib/use-action-shortcuts";
import {
  canvasContextMenuItems,
  commandMenuEpoch,
  runRegisteredAction,
  type CanvasMenuItem,
} from "../canvas-menu";
import { useEditorStore } from "../store";

function useCanvasMenuItems() {
  const actions = React.useSyncExternalStore(actionRegistry.subscribe, actionRegistry.list, actionRegistry.list);
  // Selecting a node or filling the clipboard does not replace the action list.
  useEditorStore(commandMenuEpoch);
  return canvasContextMenuItems(actions);
}

function CommandMenuItem({ item }: { item: CanvasMenuItem }) {
  const shortcut = useShortcutLabel(item.shortcut);
  return (
    <ContextMenuItem
      variant={item.destructive ? "destructive" : "default"}
      disabled={item.disabled}
      onSelect={() => runRegisteredAction(item.id)}
    >
      {item.label}
      <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>
    </ContextMenuItem>
  );
}

function CanvasContextMenuContent() {
  const items = useCanvasMenuItems();
  return (
    <ContextMenuContent className="w-56">
      {items.map((entry, index) =>
        entry.type === "separator" ? (
          <ContextMenuSeparator key={`separator-${index}`} />
        ) : (
          <CommandMenuItem key={entry.id} item={entry} />
        ),
      )}
    </ContextMenuContent>
  );
}

/** Right-click target for the flow surface. The browser menu is suppressed by the Radix trigger. */
export function CanvasContextMenu({ children }: { children: React.ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <CanvasContextMenuContent />
    </ContextMenu>
  );
}
