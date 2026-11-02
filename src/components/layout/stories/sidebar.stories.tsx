import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, userEvent, within } from "storybook/test";

import { storyRun } from "@/mocks/story-handlers";
import { Sidebar } from "../sidebar";

const meta = {
  title: "Layout/Sidebar",
  component: Sidebar,
  parameters: {
    nextjs: { navigation: { pathname: "/workbench" } },
  },
  decorators: [
    (Story) => {
      // Each story starts from a collapsed 流程 group, as a newcomer sees it.
      try { window.localStorage.removeItem("nf-studio.sidebar.flow-open"); } catch { /* storage off */ }
      return (
        <div className="h-[34rem]">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A newcomer on the workbench: two items, the 流程 group folded with a one-line summary. */
export const Workbench: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole("navigation", { name: "主导航" });
    const group = within(nav).getByRole("button", { name: /流程/ });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(within(nav).queryByRole("link", { name: "运行记录" })).toBeNull();
    await userEvent.click(group);
    await expect(within(nav).getByRole("link", { name: "运行记录" })).toBeVisible();
  },
};

/** On a pipeline page the group is open and the page is highlighted. */
export const Runs: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/runs/run_story" } },
  },
  play: async ({ canvasElement }) => {
    const link = await within(canvasElement).findByRole("link", { name: "运行记录" });
    await expect(link).toHaveAttribute("aria-current", "page");
  },
};

/** Two runs in flight show as a count next to 运行记录. */
export const RunningCount: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/workflows" } },
    msw: [
      http.get("/api/runs", () => HttpResponse.json([
        { ...storyRun, id: "r1", status: "running" },
        { ...storyRun, id: "r2", status: "submitted" },
        storyRun,
      ])),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByLabelText("2 个运行中")).toBeVisible();
  },
};

export const Dark: Story = { globals: { theme: "dark" } };
