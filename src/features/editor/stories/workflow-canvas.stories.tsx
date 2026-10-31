import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SAMPLESHEET_ID } from "@/features/workflow/builtins";
import { emptyWorkflow } from "@/features/workflow/document";
import type { WorkflowDoc } from "@/features/workflow/types";
import { WorkflowCanvas } from "../components/workflow-canvas";
import { EditorFixture } from "./fixtures";

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
