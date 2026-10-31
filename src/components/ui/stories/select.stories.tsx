import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../select";
import { expect, userEvent, within, waitFor } from "storybook/test";

const meta = { title: "UI/Select", component: Select, args: {} } satisfies Meta<
  typeof Select
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Select {...args}>
      <SelectTrigger className="w-64" aria-label="运行环境">
        <SelectValue placeholder="选择环境" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="docker">Docker</SelectItem>
        <SelectItem value="conda">Conda</SelectItem>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox");
    await userEvent.click(trigger);
    await userEvent.click(
      within(document.body).getByRole("option", { name: "Docker" }),
    );
    await expect(trigger).toHaveTextContent("Docker");
    await waitFor(() =>
      expect(
        within(document.body).queryByRole("listbox"),
      ).not.toBeInTheDocument(),
    );
  },
};
export const Disabled: Story = {
  render: Default.render,
  args: { disabled: true, defaultValue: "docker" },
};
