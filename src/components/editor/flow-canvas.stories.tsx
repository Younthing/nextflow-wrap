import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { EmptyCanvasHint } from "./empty-canvas-hint";
import { FlowCanvas } from "./flow-canvas";

const meta = {
  title: "Editor/FlowCanvas",
  component: FlowCanvas,
  decorators: [
    (Story) => (
      <div className="glass relative h-[560px] overflow-hidden rounded-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FlowCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: (args) => (
    <>
      <FlowCanvas {...args} />
      <EmptyCanvasHint />
    </>
  ),
};
