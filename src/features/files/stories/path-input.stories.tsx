import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { selectWindowProject } from "@/features/workspace/window-project";

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

/** A dropped file is uploaded into the workspace's data/ and stored by its workspace path. */
export const DropUploadsOnWeb: Story = {
  args: { workspace: true },
  // Uploads go to the window's project, as in the app after a project is opened.
  beforeEach: () => { selectWindowProject(EXAMPLE_PROJECT_ID); return () => selectWindowProject(); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText("输入文件");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["h5ad"], "pbmc_small.h5ad"));
    field.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await waitFor(() => expect(field).toHaveValue("data/pbmc_small.h5ad"));
  },
};

/** Pasting a file into the field uploads it too; pasted text is left to the input. */
export const PasteUploadsOnWeb: Story = {
  args: { workspace: true },
  // Uploads go to the window's project, as in the app after a project is opened.
  beforeEach: () => { selectWindowProject(EXAMPLE_PROJECT_ID); return () => selectWindowProject(); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText("输入文件");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "markers.csv"));
    field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    await waitFor(() => expect(field).toHaveValue("data/markers.csv"));
  },
};

/** Configuration fields (an interpreter, a key file) need a server path: a drop that would need an upload is refused. */
export const DropRefusedForConfig: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByLabelText("输入文件");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "python3"));
    field.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await expect(await within(canvasElement.ownerDocument.body).findByText("这里需要服务端上的路径，请点浏览选择")).toBeInTheDocument();
    expect(field).toHaveValue("");
  },
};

export const Directory: Story = { args: { kind: "directory", value: "/home/demo/data/filtered_feature_bc_matrix", extensions: undefined } };
