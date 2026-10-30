import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Play, Square } from "lucide-react";

import { Button } from "../button";

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "运行流程" },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive", "glass", "outline", "secondary", "ghost", "link"],
    },
    size: { control: "select", options: ["default", "sm", "lg", "icon", "icon-sm"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>
        <Play /> 启动
      </Button>
      <Button variant="destructive">
        <Square /> 停止
      </Button>
      <Button variant="glass">玻璃</Button>
      <Button variant="outline">描边</Button>
      <Button variant="secondary">次要</Button>
      <Button variant="ghost">幽灵</Button>
      <Button variant="link">链接</Button>
    </div>
  ),
};
