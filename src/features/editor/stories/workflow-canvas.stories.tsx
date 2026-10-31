import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { useStoreApi } from "@xyflow/react";

import { SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowDoc } from "@/features/workflow/types";
import { WorkflowCanvas } from "../components/workflow-canvas";
import { useEditorStore } from "../store";
import { useEditorCommands } from "../use-editor-commands";
import { EditorFixture } from "./fixtures";

/** A module widget, so a right-click can land in a text field. */
function textWidgetWorkflow(): WorkflowDoc {
  return {
    ...emptyWorkflow("wf_widget", "输入框"),
    nodes: [
      {
        id: "widget",
        position: { x: 80, y: 80 },
        data: {
          moduleId: "nf-core/hisat2/build",
          alias: "HISAT2",
          widgets: { hisat2_memory_input: "12" },
          config: {},
        },
      },
    ],
  };
}

/** Two nodes far apart, so fitting the selection leaves the other one outside the pane. */
function selectionFitWorkflow(): WorkflowDoc {
  return {
    ...emptyWorkflow("wf_fit", "选中后适应视图"),
    nodes: [
      {
        id: "selected",
        position: { x: 0, y: 0 },
        data: { moduleId: SAMPLESHEET_ID, alias: "SELECTED", widgets: {}, config: {} },
      },
      {
        id: "outside",
        position: { x: 2800, y: 1800 },
        data: { moduleId: SAMPLESHEET_ID, alias: "OUTSIDE", widgets: {}, config: {} },
      },
    ],
  };
}

function nodeBox(root: HTMLElement, id: string): DOMRect {
  const el = root.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`missing node ${id}`);
  return el.getBoundingClientRect();
}

function paneBox(root: HTMLElement): DOMRect {
  const pane = root.querySelector(".react-flow__pane");
  if (!pane) throw new Error("missing pane");
  return pane.getBoundingClientRect();
}

function intersects(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function contains(outer: DOMRect, inner: DOMRect) {
  return (
    inner.left >= outer.left - 1 &&
    inner.right <= outer.right + 1 &&
    inner.top >= outer.top - 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

const meta = {
  title: "Editor/WorkflowCanvas",
  component: WorkflowCanvas,
  args: { onRequestSearch: () => {} },
  decorators: [
    (Story) => (
      <div className="glass relative h-[620px] overflow-hidden rounded-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RnaseqDemo: Story = {
  decorators: [(Story) => <EditorFixture><Story /></EditorFixture>],
};

export const Empty: Story = {
  decorators: [(Story) => <EditorFixture doc={emptyWorkflow("wf_empty")}><Story /></EditorFixture>],
};

/** Fit frames the selected node. With nothing selected, the same control frames the whole graph. */
export const FitSelected: Story = {
  name: "Fit selected nodes",
  decorators: [
    (Story) => (
      <EditorFixture doc={selectionFitWorkflow()} selectedNodeIds={["selected"]}>
        <Story />
      </EditorFixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fit = await canvas.findByRole("button", { name: /适应视图/ });
    const label = fit.getAttribute("aria-label") ?? "";
    expect(label.startsWith("适应视图（")).toBe(true);
    expect(label).toMatch(/F/);
    expect(label).toMatch(/Shift\+1|⇧1/);

    await waitFor(() => {
      const pane = paneBox(canvasElement);
      const selected = nodeBox(canvasElement, "selected");
      const outside = nodeBox(canvasElement, "outside");
      expect(selected.width).toBeGreaterThan(10);
      expect(outside.width).toBeGreaterThan(10);
      expect(intersects(selected, pane)).toBe(true);
      expect(intersects(outside, pane)).toBe(true);
    });

    await userEvent.click(fit);

    await waitFor(() => {
      const pane = paneBox(canvasElement);
      expect(contains(pane, nodeBox(canvasElement, "selected"))).toBe(true);
      expect(intersects(nodeBox(canvasElement, "outside"), pane)).toBe(false);
    });
  },
};

const commandCalls = { search: 0 };

/** Registers the same editor commands the app does, so the menu calls those handlers. */
function CommandCanvas() {
  useState(() => {
    useEditorStore.setState({ clipboard: null, clipboardPastes: 0 });
    return true;
  });
  useEditorCommands({
    save: () => {},
    openNodeSearch: () => {
      commandCalls.search += 1;
    },
    fitView: () => {},
  });
  return <WorkflowCanvas onRequestSearch={() => {}} />;
}

async function rightClick(target: Element) {
  let prevented = false;
  const mark = (event: Event) => {
    prevented = event.defaultPrevented;
  };
  document.addEventListener("contextmenu", mark);
  await userEvent.pointer({ keys: "[MouseRight]", target });
  document.removeEventListener("contextmenu", mark);
  const menu = await screen.findByRole("menu");
  expect(prevented).toBe(true);
  return menu;
}

function menuLabels() {
  return screen.getAllByRole("menuitem").map((item) => (item.textContent ?? "").replace(/\s+/g, ""));
}

function menuItem(name: RegExp) {
  return screen.getByRole("menuitem", { name });
}

/** Radix sets aria-disabled. jest-dom's toBeDisabled ignores that on a menuitem div. */
function expectEnabled(name: RegExp) {
  expect(menuItem(name)).not.toHaveAttribute("aria-disabled");
}

function expectDisabled(name: RegExp) {
  expect(menuItem(name)).toHaveAttribute("aria-disabled", "true");
}

/** Right-click the empty pane. Commands with nothing to do are disabled; search still runs. */
export const ContextMenuEmpty: Story = {
  name: "Context menu on empty canvas",
  render: () => <CommandCanvas />,
  decorators: [
    (Story) => (
      <EditorFixture doc={emptyWorkflow("wf_menu_empty")}>
        <Story />
      </EditorFixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    commandCalls.search = 0;
    const surface = await waitFor(() => {
      const el = canvasElement.querySelector(".react-flow__pane");
      if (!el || el.getBoundingClientRect().width < 10) throw new Error("pane not ready");
      return el;
    });

    await rightClick(surface);
    await waitFor(() => expectEnabled(/搜索节点/));

    expect(menuLabels()).toEqual([
      expect.stringMatching(/^复制(Ctrl\+C|⌘C)$/),
      expect.stringMatching(/^粘贴(Ctrl\+V|⌘V)$/),
      expect.stringMatching(/^创建副本(Ctrl\+D|⌘D)$/),
      expect.stringMatching(/^删除Delete$/),
      expect.stringMatching(/^全选(Ctrl\+A|⌘A)$/),
      expect.stringMatching(/^取消选择Esc$/),
      expect.stringMatching(/^搜索节点(Ctrl\+K|⌘K)$/),
      expect.stringMatching(/^适应视图F$/),
    ]);
    expect(screen.queryByRole("menuitem", { name: /保存|撤销|重做/ })).toBeNull();

    for (const name of [/^复制/, /粘贴/, /创建副本/, /^删除/, /全选/, /取消选择/, /适应视图/]) {
      expectDisabled(name);
    }

    await userEvent.click(menuItem(/搜索节点/));
    await waitFor(() => expect(commandCalls.search).toBe(1));
    expect(useEditorStore.getState().nodes).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  },
};

/** Right-click a selected node, an unselected node, and empty canvas. Items call the registered commands. */
export const ContextMenuOnNode: Story = {
  name: "Context menu on a node",
  render: () => <CommandCanvas />,
  decorators: [
    (Story) => (
      <EditorFixture doc={selectionFitWorkflow()} selectedNodeIds={["selected"]}>
        <Story />
      </EditorFixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(nodeBox(canvasElement, "selected").width).toBeGreaterThan(10);
      expect(nodeBox(canvasElement, "outside").width).toBeGreaterThan(10);
    });

    const selected = canvasElement.querySelector(`[data-id="selected"]`);
    if (!selected) throw new Error("missing node selected");
    await rightClick(selected);
    await waitFor(() => expectEnabled(/^复制/));
    expectDisabled(/粘贴/);
    expectEnabled(/创建副本/);
    expectEnabled(/^删除/);
    expectEnabled(/取消选择/);
    expect(useEditorStore.getState().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(["selected"]);

    await userEvent.click(menuItem(/创建副本/));
    await waitFor(() => expect(useEditorStore.getState().nodes).toHaveLength(3));
    expect(useEditorStore.getState().revision).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    const outside = canvasElement.querySelector(`[data-id="outside"]`);
    if (!outside) throw new Error("missing node outside");
    await rightClick(outside);
    await waitFor(() => {
      expect(useEditorStore.getState().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(["outside"]);
    });
    await userEvent.click(menuItem(/^复制/));
    await waitFor(() => {
      expect(useEditorStore.getState().clipboard?.nodes.map((node) => node.data.alias)).toEqual(["OUTSIDE"]);
    });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    const surface = canvasElement.querySelector(".react-flow__pane");
    if (!surface) throw new Error("missing pane");
    await rightClick(surface);
    await waitFor(() => expectEnabled(/粘贴/));
    expect(useEditorStore.getState().nodes.find((node) => node.id === "outside")?.selected).toBe(true);
    await userEvent.click(menuItem(/粘贴/));
    await waitFor(() => expect(useEditorStore.getState().nodes).toHaveLength(4));
  },
};

/** Same commands, with React Flow's box-selection rectangle already showing. */
function BoxSelectionCanvas() {
  const store = useStoreApi();
  useState(() => {
    useEditorStore.setState({ clipboard: null, clipboardPastes: 0 });
    return true;
  });
  useEditorCommands({
    save: () => {},
    openNodeSearch: () => {
      commandCalls.search += 1;
    },
    fitView: () => {},
  });
  useEffect(() => {
    store.setState({ nodesSelectionActive: true });
  }, [store]);
  return <WorkflowCanvas onRequestSearch={() => {}} />;
}

/** Right-clicking a node outside the box drops the rectangle. The box stays when the node is already inside it. */
export const ContextMenuClearsSelectionBox: Story = {
  name: "Context menu clears the selection box",
  render: () => <BoxSelectionCanvas />,
  decorators: [
    (Story) => (
      <EditorFixture doc={selectionFitWorkflow()} selectedNodeIds={["selected"]}>
        <Story />
      </EditorFixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(nodeBox(canvasElement, "outside").width).toBeGreaterThan(10);
      expect(canvasElement.querySelector(".react-flow__nodesselection")).toBeTruthy();
    });

    const selected = canvasElement.querySelector(`[data-id="selected"]`);
    const outside = canvasElement.querySelector(`[data-id="outside"]`);
    if (!selected || !outside) throw new Error("missing nodes");

    await rightClick(selected);
    expect(canvasElement.querySelector(".react-flow__nodesselection")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    await rightClick(outside);
    await waitFor(() => {
      expect(canvasElement.querySelector(".react-flow__nodesselection")).toBeNull();
      expect(useEditorStore.getState().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(["outside"]);
    });
  },
};

/** Two nodes and the link between them. Right-click retargets the selection, then Delete removes it. */
function linkedPair(): WorkflowDoc {
  return {
    ...emptyWorkflow("wf_delete", "删除"),
    nodes: [
      {
        id: "keep",
        position: { x: 40, y: 80 },
        data: { moduleId: SAMPLESHEET_ID, alias: "KEEP", widgets: {}, config: {} },
      },
      {
        id: "drop",
        position: { x: 420, y: 80 },
        data: { moduleId: "nf-core/fastqc", alias: "FASTQC", widgets: {}, config: {} },
      },
    ],
    edges: [
      {
        id: "e-keep-drop",
        source: "keep",
        sourceHandle: "out:reads",
        target: "drop",
        targetHandle: "in:reads",
      },
    ],
  };
}

/** Right-click an unselected node, delete that selection, and undo it back. */
export const ContextMenuDeletesNode: Story = {
  name: "Context menu deletes the node",
  render: () => <CommandCanvas />,
  decorators: [
    (Story) => (
      <EditorFixture doc={linkedPair()} selectedNodeIds={["keep"]}>
        <Story />
      </EditorFixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(nodeBox(canvasElement, "keep").width).toBeGreaterThan(10);
      expect(nodeBox(canvasElement, "drop").width).toBeGreaterThan(10);
    });

    const drop = canvasElement.querySelector(`[data-id="drop"]`);
    if (!drop) throw new Error("missing node drop");
    await rightClick(drop);
    await waitFor(() => {
      expect(useEditorStore.getState().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(["drop"]);
    });
    expectEnabled(/^删除/);
    expect(useEditorStore.getState().edges.map((edge) => edge.id)).toEqual(["e-keep-drop"]);

    await userEvent.click(menuItem(/^删除/));
    await waitFor(() => {
      expect(useEditorStore.getState().nodes.map((node) => node.id)).toEqual(["keep"]);
      expect(useEditorStore.getState().edges).toEqual([]);
      expect(useEditorStore.getState().past).toHaveLength(1);
      expect(canvasElement.querySelector(`[data-id="drop"]`)).toBeNull();
    });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    useEditorStore.getState().undo();
    await waitFor(() => {
      expect(useEditorStore.getState().nodes.map((node) => node.id)).toEqual(["keep", "drop"]);
      expect(useEditorStore.getState().edges.map((edge) => edge.id)).toEqual(["e-keep-drop"]);
      expect(nodeBox(canvasElement, "drop").width).toBeGreaterThan(10);
    });

    await userEvent.keyboard("{Delete}");
    await waitFor(() => {
      expect(useEditorStore.getState().nodes.map((node) => node.id)).toEqual(["keep"]);
      expect(useEditorStore.getState().edges).toEqual([]);
    });
  },
};

/** A widget input keeps the browser text menu. The canvas commands stay closed. */
export const ContextMenuOnTextInput: Story = {
  name: "Context menu leaves text inputs",
  render: () => <CommandCanvas />,
  decorators: [
    (Story) => (
      <EditorFixture doc={textWidgetWorkflow()}>
        <Story />
      </EditorFixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const input = await waitFor(() => {
      const el = canvasElement.querySelector(".react-flow__node input");
      if (!(el instanceof HTMLInputElement) || el.getBoundingClientRect().width < 10) {
        throw new Error("widget input not ready");
      }
      return el;
    });
    const seen: { event: Event | null } = { event: null };
    const mark = (event: Event) => {
      seen.event = event;
    };
    window.addEventListener("contextmenu", mark, true);
    await userEvent.pointer({ keys: "[MouseRight]", target: input });
    window.removeEventListener("contextmenu", mark, true);
    expect(seen.event?.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(input.value).toBe("12");

    useEditorStore.setState({
      nodes: useEditorStore.getState().nodes.map((node) => ({ ...node, selected: true })),
    });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    await userEvent.keyboard("{Backspace}");
    await waitFor(() => expect(input.value).toBe("1"));
    expect(useEditorStore.getState().nodes.map((node) => node.id)).toEqual(["widget"]);
  },
};
