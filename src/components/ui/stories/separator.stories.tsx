import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Separator } from "../separator";

const meta = {
  title: "UI/Separator",
  component: Separator,
  args: {},
} satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <span>流程</span>
      <Separator />
      <span>运行</span>
    </div>
  ),
};
export const Vertical: Story = {
  args: { orientation: "vertical", className: "h-12" },
};
