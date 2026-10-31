import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { formatShortcut, primaryCombo } from "@/lib/actions";
import { EDITOR_ACTIONS } from "@/features/editor/commands";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../context-menu";

const meta = {
  title: "UI/Context menu",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Right-click the panel. Labels and Mac glyphs come from the command registry. */
export const Basic: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="glass flex h-48 w-80 items-center justify-center rounded-xl text-sm text-muted-foreground">
        右键打开菜单
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem>
          {EDITOR_ACTIONS.undo.label}
          <ContextMenuShortcut>{formatShortcut(primaryCombo(EDITOR_ACTIONS.undo.shortcut), "mac")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          {EDITOR_ACTIONS.redo.label}
          <ContextMenuShortcut>{formatShortcut(primaryCombo(EDITOR_ACTIONS.redo.shortcut), "mac")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>子菜单</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>
              {EDITOR_ACTIONS.save.label}
              <ContextMenuShortcut>{formatShortcut(primaryCombo(EDITOR_ACTIONS.save.shortcut), "mac")}</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
