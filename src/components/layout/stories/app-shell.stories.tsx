import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { NEXTFLOW_VERSION } from "@/features/project/templates";
import { AppShell } from "../app-shell";
const meta = {
  title: "Layout/AppShell",
  component: AppShell,
  args: { children: <div className="glass h-full rounded-xl p-5">工作区</div> },
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
export const Light: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const version = await canvas.findByText(new RegExp(`Nextflow ${NEXTFLOW_VERSION.replaceAll(".", "\\.")}`));
    const simulated = canvas.getByText("模拟");
    const versionBox = version.closest("[data-slot='badge']")?.getBoundingClientRect();
    const simulatedBox = simulated.closest("[data-slot='badge']")?.getBoundingClientRect();
    expect(versionBox && simulatedBox).toBeTruthy();
    expect(Math.abs((versionBox?.top ?? 0) - (simulatedBox?.top ?? 0))).toBeLessThan(4);
  },
};
export const Dark: Story = { globals: { theme: "dark" } };
