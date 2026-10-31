import { describe, expect, it, vi } from "vitest";

import { createActionRegistry, type Action } from "@/lib/actions";
import {
  canvasContextMenuItems,
  commandMenuEpoch,
  runRegisteredAction,
  selectionForContextTarget,
  type CanvasMenuItem,
} from "./canvas-menu";
import { EDITOR_ACTIONS, editorActions, type EditorCommandHandlers } from "./commands";

function handlers(overrides: Partial<EditorCommandHandlers> = {}): EditorCommandHandlers {
  return {
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    selectAll: vi.fn(),
    deselect: vi.fn(),
    openNodeSearch: vi.fn(),
    fitView: vi.fn(),
    canUndo: () => true,
    canRedo: () => true,
    canCopy: () => true,
    canPaste: () => true,
    canDuplicate: () => true,
    canDelete: () => true,
    canSelectAll: () => true,
    canDeselect: () => true,
    canFitView: () => true,
    ...overrides,
  };
}

function items(actions: readonly Action[]): CanvasMenuItem[] {
  return canvasContextMenuItems(actions).flatMap((entry) => (entry.type === "item" ? [entry] : []));
}

describe("canvas context menu", () => {
  it("lists the canvas commands in ComfyUI groups and leaves save, undo, and redo on the toolbar", () => {
    const menu = canvasContextMenuItems(editorActions(handlers()));
    const labels = menu.filter((entry) => entry.type === "item").map((entry) => entry.label);
    expect(labels).toEqual(["复制", "粘贴", "创建副本", "删除", "全选", "取消选择", "搜索节点", "适应视图"]);
    expect(menu.filter((entry) => entry.type === "separator")).toHaveLength(2);
    expect(menu.findIndex((entry) => entry.type === "separator")).toBe(4);
    expect(menu.findLastIndex((entry) => entry.type === "separator")).toBe(7);

    const listed = items(editorActions(handlers()));
    expect(listed.map((entry) => entry.id)).toEqual([
      EDITOR_ACTIONS.copy.id,
      EDITOR_ACTIONS.paste.id,
      EDITOR_ACTIONS.duplicate.id,
      EDITOR_ACTIONS.delete.id,
      EDITOR_ACTIONS.selectAll.id,
      EDITOR_ACTIONS.deselect.id,
      EDITOR_ACTIONS.search.id,
      EDITOR_ACTIONS.fit.id,
    ]);
    expect(listed.find((entry) => entry.id === EDITOR_ACTIONS.delete.id)?.destructive).toBe(true);
    expect(listed.filter((entry) => entry.id !== EDITOR_ACTIONS.delete.id).every((entry) => !entry.destructive)).toBe(
      true,
    );
    const ids = listed.map((entry) => entry.id);
    expect(ids).not.toContain(EDITOR_ACTIONS.save.id);
    expect(ids).not.toContain(EDITOR_ACTIONS.undo.id);
    expect(ids).not.toContain(EDITOR_ACTIONS.redo.id);
  });

  it("disables a command exactly when its can predicate is false", () => {
    let canPaste = false;
    let canDelete = false;
    const actions = editorActions(
      handlers({
        canCopy: () => false,
        canPaste: () => canPaste,
        canDuplicate: () => false,
        canDelete: () => canDelete,
        canSelectAll: () => false,
        canDeselect: () => false,
        canFitView: () => false,
      }),
    );
    const byId = new Map(items(actions).map((entry) => [entry.id, entry]));
    expect(byId.get(EDITOR_ACTIONS.copy.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.paste.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.duplicate.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.delete.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.selectAll.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.deselect.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.fit.id)?.disabled).toBe(true);
    expect(byId.get(EDITOR_ACTIONS.search.id)?.disabled).toBe(false);
    expect(byId.get(EDITOR_ACTIONS.copy.id)?.label).toBe(EDITOR_ACTIONS.copy.label);
    expect(byId.get(EDITOR_ACTIONS.copy.id)?.shortcut).toBe(EDITOR_ACTIONS.copy.shortcut);
    expect(byId.get(EDITOR_ACTIONS.delete.id)?.label).toBe(EDITOR_ACTIONS.delete.label);
    expect(byId.get(EDITOR_ACTIONS.delete.id)?.shortcut).toBe(EDITOR_ACTIONS.delete.shortcut);

    canPaste = true;
    canDelete = true;
    const enabled = new Map(items(actions).map((entry) => [entry.id, entry]));
    expect(enabled.get(EDITOR_ACTIONS.paste.id)?.disabled).toBe(false);
    expect(enabled.get(EDITOR_ACTIONS.delete.id)?.disabled).toBe(false);
    expect(enabled.get(EDITOR_ACTIONS.copy.id)?.disabled).toBe(true);
  });

  it("keeps every command disabled until it is registered", () => {
    const menu = items([]);
    expect(menu).toHaveLength(8);
    expect(menu.every((entry) => entry.disabled)).toBe(true);
  });

  it("runs the registered handler and refuses a disabled one", () => {
    const copy = vi.fn();
    const paste = vi.fn();
    const remove = vi.fn();
    const registry = createActionRegistry();
    registry.registerAll(
      editorActions(
        handlers({
          copy,
          paste,
          delete: remove,
          canCopy: () => true,
          canPaste: () => false,
          canDelete: () => false,
        }),
      ),
    );

    expect(runRegisteredAction(EDITOR_ACTIONS.copy.id, registry)).toBe(true);
    expect(copy).toHaveBeenCalledOnce();
    expect(runRegisteredAction(EDITOR_ACTIONS.paste.id, registry)).toBe(false);
    expect(paste).not.toHaveBeenCalled();
    expect(runRegisteredAction(EDITOR_ACTIONS.delete.id, registry)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(runRegisteredAction(EDITOR_ACTIONS.save.id, registry)).toBe(true);
    expect(runRegisteredAction("Comfy.Missing", registry)).toBe(false);
  });

  it("changes the menu epoch when selection or the clipboard changes", () => {
    const idle = { nodes: [{ selected: false }, { selected: false }], edges: [{ selected: false }], clipboard: null };
    expect(commandMenuEpoch(idle)).toBe(commandMenuEpoch({ ...idle, nodes: [...idle.nodes] }));
    expect(commandMenuEpoch(idle)).not.toBe(commandMenuEpoch({ ...idle, nodes: [{ selected: true }, { selected: false }] }));
    expect(commandMenuEpoch(idle)).not.toBe(commandMenuEpoch({ ...idle, edges: [{ selected: true }] }));
    expect(commandMenuEpoch(idle)).not.toBe(commandMenuEpoch({ ...idle, clipboard: { nodes: [{}] } }));
    expect(commandMenuEpoch(idle)).not.toBe(commandMenuEpoch({ ...idle, nodes: [] }));
  });
});

describe("selection for a node context menu", () => {
  it("leaves a node that is already selected, including the rest of the selection", () => {
    const nodes = [
      { id: "a", selected: true },
      { id: "b", selected: true },
    ];
    const edges = [{ selected: true }];
    expect(selectionForContextTarget(nodes, edges, "a")).toBeNull();
    expect(selectionForContextTarget(nodes, edges, "missing")).toBeNull();
  });

  it("selects the node under the pointer and clears other nodes and links", () => {
    const kept = { id: "a", selected: false };
    const target = { id: "b" };
    const edges = [{ id: "e", selected: false }];
    const next = selectionForContextTarget([kept, target, { id: "c", selected: true }], edges, "b");
    expect(next?.nodes[0]).toBe(kept);
    expect(next?.nodes[1]).toMatchObject({ id: "b", selected: true });
    expect(next?.nodes[2]).toMatchObject({ id: "c", selected: false });
    expect(next?.edges).toBe(edges);

    const linked = selectionForContextTarget(
      [{ id: "a", selected: true }, { id: "b", selected: false }],
      [{ id: "e", selected: true }],
      "b",
    );
    expect(linked?.nodes.map((node) => node.selected)).toEqual([false, true]);
    expect(linked?.edges.map((edge) => edge.selected)).toEqual([false]);
  });
});
