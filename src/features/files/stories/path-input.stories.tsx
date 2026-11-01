import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { PathInput } from "../components/path-input";

const meta = {
  title: "Files/PathInput",
  component: PathInput,
  args: { value: "", onChange: () => {}, "aria-label": "输入文件", extensions: ["h5ad"] },
  render: function Controlled(args) {
    const [value, setValue] = useState(args.value);
    return <div className="w-96"><PathInput {...args} value={value} onChange={setValue} /></div>;
  },
} satisfies Meta<typeof PathInput>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Without the desktop bridge the button opens the web browser of the runner machine. */
export const BrowseOnWeb: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "浏览文件" }));
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.dblClick(await page.findByText("data"));
    await userEvent.dblClick(await page.findByText("pbmc3k.h5ad"));
    await waitFor(() => expect(canvas.getByLabelText("输入文件")).toHaveValue("/home/demo/data/pbmc3k.h5ad"));
  },
};

export const Directory: Story = { args: { kind: "directory", value: "/home/demo/data/filtered_feature_bc_matrix", extensions: undefined } };
