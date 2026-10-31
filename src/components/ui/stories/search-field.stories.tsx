import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SearchField } from "../search-field";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "UI/SearchField",
  component: SearchField,
  args: {
    "aria-label": "搜索流程",
    placeholder: "搜索流程",
    autoComplete: "off",
  },
  argTypes: {
    size: {
      control: "select",
      options: ["default", "compact"],
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox");
    await userEvent.type(input, "rnaseq");
    await expect(input).toHaveValue("rnaseq");
  },
};
export const Compact: Story = {
  args: {
    size: "compact",
    placeholder: "搜索模块",
    "aria-label": "搜索模块",
  },
};
export const Disabled: Story = {
  args: { disabled: true, defaultValue: "rnaseq" },
};
export const WithValue: Story = {
  args: { defaultValue: "rnaseq" },
};
