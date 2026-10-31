import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PanelLoading, PanelNotice } from "../panel-notice";
import { Button } from "../button";

const meta = {
  title: "UI/PanelNotice",
  component: PanelNotice,
  args: { message: "没有可显示的数据" },
  decorators: [
    (Story) => (
      <div className="h-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PanelNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Error: Story = {
  args: {
    message: "加载失败，请稍后重试",
    tone: "danger",
    children: <Button variant="outline">返回</Button>,
  },
};
export const Loading: Story = {
  render: () => <PanelLoading message="加载模块库和流程…" />,
};
export const LoadingIcon: Story = { render: () => <PanelLoading /> };
