import type { ComponentType, ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus, Workflow } from "lucide-react";

import { AsyncPlaceholder } from "../async-placeholder";
import { Button } from "../button";

// Storybook intersects discriminated unions into `never`. Args use one object;
// the component prop type stays a union for call sites.
type AsyncPlaceholderStoryArgs = {
  status: "pending" | "error" | "empty";
  message?: string;
  icon?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

const meta = {
  title: "UI/AsyncPlaceholder",
  component: AsyncPlaceholder as ComponentType<AsyncPlaceholderStoryArgs>,
  decorators: [
    (Story) => (
      <div className="h-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<ComponentType<AsyncPlaceholderStoryArgs>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  args: { status: "pending" },
};

export const Error: Story = {
  args: {
    status: "error",
    message: "加载流程失败：无法读取工作流列表",
  },
};

export const Empty: Story = {
  args: {
    status: "empty",
    icon: <Workflow />,
    description: "还没有流程",
    children: (
      <Button type="button" variant="outline" size="sm">
        <Plus /> 新建空白流程
      </Button>
    ),
  },
};

export const LongText: Story = {
  args: {
    status: "error",
    message:
      "加载运行记录失败：执行器在读取 samplesheet 时中断，并返回了一段很长的说明。占位内容需要在已有面板内换行，保留完整错误，而不是把外层玻璃表面再包一层。",
  },
};
