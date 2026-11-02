import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ExportProjectDialog } from "../components/export-project-dialog";
import { EditorFixture } from "@/features/editor/stories/fixtures";
const meta = {
  title: "Runs/ExportProjectDialog",
  component: ExportProjectDialog,
  args: {
    open: true,
    onOpenChange: fn(),
  },
  decorators: [
    (Story) => (
      <EditorFixture>
        <Story />
      </EditorFixture>
    ),
  ],
} satisfies Meta<typeof ExportProjectDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Project: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog", { name: "导出 Nextflow 项目" }));
    await expect(await dialog.findByRole("list", { name: "项目文件" })).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: /下载 \.zip/ })).toBeEnabled();
    await userEvent.click(dialog.getByRole("tab", { name: "命令和配置" }));
    await expect(dialog.getByText("params.json（-params-file）")).toBeInTheDocument();
  },
};
