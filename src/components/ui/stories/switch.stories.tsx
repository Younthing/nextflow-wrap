import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch } from "../switch";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "UI/Switch",
  component: Switch,
  args: { "aria-label": "启用缓存" },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole("switch");
    await userEvent.click(control);
    await expect(control).toBeChecked();
  },
};
export const Checked: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
