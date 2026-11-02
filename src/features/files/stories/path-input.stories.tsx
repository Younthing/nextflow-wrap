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

/** In a browser (or with a remote backend) a dropped file is uploaded to the project's data/ and its server path filled in. */
export const DropUploadsOnWeb: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText("输入文件");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["h5ad"], "pbmc_small.h5ad"));
    field.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await waitFor(() => expect(field).toHaveValue("/home/demo/Projects/pbmc-atlas/data/pbmc_small.h5ad"));
  },
};

/** Pasting a file into the field uploads it too; pasted text is left to the input. */
export const PasteUploadsOnWeb: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText("输入文件");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "markers.csv"));
    field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    await waitFor(() => expect(field).toHaveValue("/home/demo/Projects/pbmc-atlas/data/markers.csv"));
  },
};

export const Directory: Story = { args: { kind: "directory", value: "/home/demo/data/filtered_feature_bc_matrix", extensions: undefined } };
