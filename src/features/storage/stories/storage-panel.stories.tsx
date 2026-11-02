import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { StorageView } from "../components/storage-panel";
import { sampleStorageReport } from "../samples";

const meta = {
  title: "Settings/StorageView",
  component: StorageView,
  args: { report: sampleStorageReport(), onClean: fn() },
} satisfies Meta<typeof StorageView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CleanSession: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const running = canvas.getByRole("listitem", { name: "分子对接（Vina） 会话" });
    await expect(within(running).getByRole("button", { name: /清理/ })).toBeDisabled();
    const sessions = canvas.getAllByRole("listitem", { name: "PBMC 3k 单细胞 会话" });
    await userEvent.click(within(sessions[0]).getByRole("button", { name: /清理/ }));
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog");
    await expect(within(dialog).getByText(/不能再续跑/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /清理/ }));
    await expect(args.onClean).toHaveBeenCalledWith(expect.objectContaining({ workflowName: "PBMC 3k 单细胞" }), false);
  },
};
