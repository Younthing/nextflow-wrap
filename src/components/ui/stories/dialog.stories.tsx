import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../dialog";
import { Button } from "../button";
import { expect, userEvent, within, waitFor } from "storybook/test";

const meta = { title: "UI/Dialog", component: Dialog, args: {} } satisfies Meta<
  typeof Dialog
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Keyboard: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>打开配置</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>运行配置</DialogTitle>
          <DialogDescription>检查配置后关闭。</DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button>完成</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "打开配置",
    });
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(within(document.body).getByRole("dialog")).toBeVisible(),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
