import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { emptyWorkflow } from "@/features/workflow/document";
import { WorkflowCanvas } from "../components/workflow-canvas";
import { EditorFixture } from "./fixtures";

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
