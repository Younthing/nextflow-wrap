import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip";
import { Button } from "../button";

const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
  args: {},
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">保存</Button>
      </TooltipTrigger>
      <TooltipContent>保存当前流程</TooltipContent>
    </Tooltip>
  ),
};
