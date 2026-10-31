import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { EditorProvider } from "../editor-provider";
import { WorkflowEditor } from "../components/workflow-editor";
import type { WorkflowDoc } from "@/features/workflow/types";

const saved = fn();
const meta = {
  title: "Editor/WorkflowEditor",
  component: WorkflowEditor,
  args: { workflowId: "wf_story" },
  beforeEach: () => {
    saved.mockClear();
  },
  decorators: [
    (Story) => (
      <EditorProvider>
        <div className="h-[800px]">
          <Story />
        </div>
      </EditorProvider>
    ),
  ],
} satisfies Meta<typeof WorkflowEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Autosave: Story = {
  parameters: {
    msw: [
      http.put("/api/workflows/:id", async ({ request }) => {
        const doc = (await request.json()) as WorkflowDoc;
        saved(doc);
        return HttpResponse.json({
          ...doc,
          updatedAt: "2026-01-02T12:00:00.000Z",
        });
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = await canvas.findByRole("textbox", { name: "流程名称" });
    await userEvent.clear(name);
    await userEvent.type(name, "Updated workflow");
    await waitFor(
      () =>
        expect(saved).toHaveBeenCalledWith(
          expect.objectContaining({ id: "wf_story", name: "Updated workflow" }),
        ),
      { timeout: 5000 },
    );
    await waitFor(() => expect(canvas.getByTitle("已保存")).toBeVisible());
    await expect(name).toHaveValue("Updated workflow");
  },
};
export const Missing: Story = {
  parameters: {
    msw: [
      http.get("/api/workflows/:id", () =>
        HttpResponse.json({ message: "不存在" }, { status: 404 }),
      ),
    ],
  },
};
export const CatalogError: Story = {
  parameters: {
    msw: [
      http.get("/api/modules", () =>
        HttpResponse.json({ message: "模块库不可用" }, { status: 500 }),
      ),
    ],
  },
};
