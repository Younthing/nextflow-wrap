import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse, delay } from "msw";

import { RunsBrowse } from "../components/runs-browse";

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
export const Error: Story = {
  parameters: {
    msw: [
      http.get("/api/runs", () =>
        HttpResponse.json({ message: "加载失败" }, { status: 500 }),
      ),
    ],
  },
};
