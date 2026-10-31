import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse, delay } from "msw";
import { RunsTable } from "../components/runs-table";
import { RunDetailView } from "../components/run-detail";
import { storyRun } from "@/mocks/story-handlers";

const params = Promise.resolve({ id: "run_story" });
const meta = {
  title: "Runs/Pages",
  decorators: [
    (Story) => (
      <div className="h-[720px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const List: Story = { render: () => <RunsTable /> };
export const Empty: Story = {
  ...List,
  parameters: { msw: [http.get("/api/runs", () => HttpResponse.json([]))] },
};
export const Loading: Story = {
  ...List,
  parameters: {
    msw: [
      http.get("/api/runs", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    ],
  },
};
export const Error: Story = {
  ...List,
  parameters: {
    msw: [
      http.get("/api/runs", () =>
        HttpResponse.json({ message: "加载失败" }, { status: 500 }),
      ),
    ],
  },
};
export const Detail: Story = {
  render: () => <RunDetailView params={params} />,
};
export const Failed: Story = {
  ...Detail,
  parameters: {
    msw: [
      http.get("/api/runs/:id", () =>
        HttpResponse.json({
          ...storyRun,
          status: "failed",
          errorMessage: "Process FASTQC exited with code 1",
        }),
      ),
    ],
  },
};
export const Missing: Story = {
  ...Detail,
  parameters: {
    msw: [
      http.get("/api/runs/:id", () =>
        HttpResponse.json({ message: "不存在" }, { status: 404 }),
      ),
    ],
  },
};
