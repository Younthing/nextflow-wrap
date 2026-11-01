import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse, delay } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { storyRun } from "@/mocks/story-handlers";
import { RunsBrowse } from "../components/runs-browse";

const runningProgress = {
  total: 13,
  pending: 6,
  running: 3,
  completed: 4,
  cached: 0,
  failed: 0,
  aborted: 0,
};

function stopHandlers() {
  let stopped = false;
  const run = () => ({ ...storyRun, status: stopped ? "cancelled" as const : "running" as const, progress: runningProgress });
  return [
    http.get("/api/runs", () => HttpResponse.json([run()])),
    http.post("/api/runs/:id/cancel", () => {
      stopped = true;
      return HttpResponse.json(run());
    }),
  ];
}

const meta = {
  title: "Runs/Browse",
  component: RunsBrowse,
  decorators: [
    (Story) => (
      <div className="h-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunsBrowse>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = {
  parameters: {
    msw: [http.get("/api/runs", () => HttpResponse.json([]))],
  },
};
export const Loading: Story = {
  parameters: {
    msw: [
      http.get("/api/runs", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    ],
  },
};
export const ConfirmStop: Story = {
  parameters: { msw: stopHandlers() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByText(/任务 4\/13 完成/)).resolves.toBeInTheDocument();
    await expect(canvas.findByText("预览")).resolves.toBeInTheDocument();
    const stop = await canvas.findByRole("button", { name: "停止" });
    expect(stop.className).toContain("bg-secondary");
    expect(stop.className).not.toContain("bg-destructive");
    await userEvent.click(stop);
    const dialog = await within(document.body).findByRole("dialog");
    expect(dialog).toHaveTextContent("tender_curie");
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
    await expect(canvas.getByText("运行中")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "停止" }));
    await userEvent.click(await within(document.body).findByRole("button", { name: "确认停止" }));
    await expect(canvas.findByText("已停止")).resolves.toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByRole("button", { name: "停止" })).toBeNull());
  },
};
export const Error: Story = {
  parameters: {
    msw: [
      http.get("/api/runs", () =>
        HttpResponse.json({ message: "加载失败" }, { status: 500 }),
      ),
    ],
  },
};
