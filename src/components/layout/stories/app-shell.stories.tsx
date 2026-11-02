import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { NEXTFLOW_VERSION } from "@/features/project/templates";
import { AppShell } from "../app-shell";
const meta = {
  title: "Layout/AppShell",
  component: AppShell,
  args: { children: <div className="glass h-full rounded-xl p-5">工作区</div> },
  parameters: { nextjs: { navigation: { pathname: "/workbench" } } },
  decorators: [
    (Story) => (
      <div className="h-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;
/** The sidebar carries the backend status; in the mocked build it says so inside the same badge. */
export const Light: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const version = await canvas.findByText(new RegExp(`Nextflow ${NEXTFLOW_VERSION.replaceAll(".", "\\.")}`));
    const badge = version.closest("[data-slot='badge']");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain("模拟");
    expect(within(canvas.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /深色模式|浅色模式/ })).toBeVisible();
  },
};
export const Dark: Story = { globals: { theme: "dark" } };

/** The welcome page and setup draw their own layout: no sidebar, no top bar. */
export const Bare: Story = {
  parameters: { nextjs: { navigation: { pathname: "/" } } },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("navigation", { name: "主导航" })).toBeNull();
  },
};
