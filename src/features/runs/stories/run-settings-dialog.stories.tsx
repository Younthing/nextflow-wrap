import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import { RunSettingsDialog } from "../components/run-settings-dialog";
import { EditorFixture } from "@/features/editor/stories/fixtures";
const meta = {
  title: "Runs/RunSettingsDialog",
  component: RunSettingsDialog,
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
} satisfies Meta<typeof RunSettingsDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog", { name: "运行设置" }));
    const command = dialog.getByText("启动命令（在项目目录中执行）");
    expect(command.parentElement).toHaveTextContent("nextflow run .");
    await expect(dialog.getByText(/模拟运行，不连接真实执行器/)).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "保存设置" })).toBeEnabled();
  },
};
export const Invalid: Story = {
  args: { issues: [{ level: "error", message: "COUNTS：还没有选择文件" }] },
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog", { name: "运行设置" }));
    await expect(dialog.getByText("COUNTS：还没有选择文件")).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "启动运行" })).toBeDisabled();
  },
};
