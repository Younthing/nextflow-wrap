import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { EXAMPLE_PROJECT_ID } from "@/features/workspace/projects";
import { selectWindowProject } from "@/features/workspace/window-project";
import { TextEditor } from "../components/text-editor";

/** A text file in the demo's example project, written through the same `/api/documents` the editor uses. */
async function seed(path: string, content: string) {
  const url = `/api/documents?project=${EXAMPLE_PROJECT_ID}&path=${encodeURIComponent(path)}`;
  const current = await fetch(url);
  const version = current.ok ? ((await current.json()) as { version: string }).version : null;
  const saved = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, version }) });
  return ((await saved.json()) as { version: string }).version;
}

const meta = {
  title: "Workbench/TextEditor",
  component: TextEditor,
  parameters: { nextjs: { navigation: { pathname: "/workbench/file/notes" } } },
  render: (args) => <div className="flex h-[420px] w-[640px] flex-col glass rounded-xl"><TextEditor {...args} /></div>,
  beforeEach: () => { selectWindowProject(EXAMPLE_PROJECT_ID); return () => selectWindowProject(); },
} satisfies Meta<typeof TextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edits save over the version that was read; the status returns to 已保存. */
export const EditAndSave: Story = {
  args: { path: "notes/plan.md" },
  beforeEach: async () => { await seed("notes/plan.md", "# 分析计划\n"); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = await canvas.findByRole("textbox", { name: "notes/plan.md" });
    await waitFor(() => expect(editor).toHaveValue("# 分析计划\n"));
    await userEvent.type(editor, "1. 质控");
    await expect(canvas.getByText("未保存")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(canvas.getByText("已保存")).toBeVisible());
  },
};

/**
 * Another editor changed the file after this one read it: the save is refused, the local edit is kept, and the
 * conflict offers comparing, reloading, a copy or an explicit overwrite.
 */
export const ExternalChangeConflict: Story = {
  args: { path: "notes/conflict.md" },
  beforeEach: async () => { await seed("notes/conflict.md", "原始内容\n"); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = await canvas.findByRole("textbox", { name: "notes/conflict.md" });
    await waitFor(() => expect(editor).toHaveValue("原始内容\n"));
    await seed("notes/conflict.md", "外部编辑器写入的内容\n");
    await userEvent.type(editor, "本地编辑");
    await userEvent.click(canvas.getByRole("button", { name: "保存" }));
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent("文件在外部被修改");
    await expect(editor).toHaveValue("原始内容\n本地编辑");
    await userEvent.click(within(alert).getByRole("button", { name: "比较磁盘内容" }));
    await expect(await canvas.findByText("外部编辑器写入的内容")).toBeVisible();
    await userEvent.click(within(alert).getByRole("button", { name: "用本地内容覆盖" }));
    await waitFor(() => expect(canvas.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(canvas.getByText("已保存")).toBeVisible());
  },
};
