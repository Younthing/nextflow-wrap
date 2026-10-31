import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Textarea } from "../textarea";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: {
    "aria-label": "流程名称",
    placeholder: "输入流程名称",
    className: "max-w-sm",
  },
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox");
    await userEvent.type(input, "workflow");
    await expect(input).toHaveValue("workflow");
  },
};
export const Disabled: Story = {
  args: { disabled: true, defaultValue: "只读配置" },
};
export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "invalid" },
};
export const LongContent: Story = {
  args: { defaultValue: "长内容 / ".repeat(30) },
};
