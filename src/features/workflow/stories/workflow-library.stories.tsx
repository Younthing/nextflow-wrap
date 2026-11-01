import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse, delay } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { WorkflowLibrary } from "../components/workflow-library";

const meta = {
  title: "Workflow/Library",
  component: WorkflowLibrary,
  decorators: [
    (Story) => (
      <div className="h-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowLibrary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = {
  parameters: {
    msw: [http.get("/api/workflows", () => HttpResponse.json([]))],
  },
};
export const Loading: Story = {
  parameters: {
    msw: [
      http.get("/api/workflows", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    ],
  },
};
export const Error: Story = {
  parameters: {
    msw: [
      http.get("/api/workflows", () =>
        HttpResponse.json({ message: "加载失败" }, { status: 500 }),
      ),
    ],
  },
};
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: /单细胞/ });
    await userEvent.type(
      canvas.getByRole("textbox", { name: "搜索流程" }),
      "no-matching-workflow",
    );
    await expect(
      canvas.queryByRole("link", { name: /单细胞/ }),
    ).not.toBeInTheDocument();
  },
};
