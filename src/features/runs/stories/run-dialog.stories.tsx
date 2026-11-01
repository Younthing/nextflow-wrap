import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import { RunDialog } from "../components/run-dialog";
import { EditorFixture } from "@/features/editor/stories/fixtures";
const meta = {
  title: "Runs/RunDialog",
  component: RunDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    issues: [],
  },
  decorators: [
    (Story) => (
      <EditorFixture>
        <Story />
      </EditorFixture>
    ),
  ],
} satisfies Meta<typeof RunDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog", { name: "运行流程" }));
    await expect(dialog.getByRole("tab", { name: "运行环境" })).toHaveAttribute("data-state", "active");
    const command = dialog.getByText("启动命令（在项目目录中执行）");
    expect(command.parentElement).toHaveTextContent("nextflow run .");
    await expect(dialog.getByText(/预览环境不会连接真实的集群或云执行器/)).toBeInTheDocument();
  },
};
export const Invalid: Story = {
  args: { issues: [{ level: "error", message: "缺少输入样本表" }] },
};
